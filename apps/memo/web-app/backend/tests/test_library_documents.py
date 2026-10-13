import json
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

import httpx
import mongomock
from fastapi.testclient import TestClient

from backend.auth import Accounts
from backend.decks import DeckError, MongoDecks
from backend.library_documents import LibraryDocuments
from backend.main import create_app
from backend.reference_documents import ReferenceDocuments, presentation_annotations
from backend.tests.document_fixtures import course_pdf, course_pptx

PASSWORD = "library-test-passphrase-123"
HEADERS = {"Origin": "https://memo.test", "X-Memo-Request": "1"}


class LibraryDocumentTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.directory = Path(self.temp.name)
        self.pdf = course_pdf(self.directory / "Cours.pdf").read_bytes()
        self.pptx = course_pptx(self.directory / "Cours.pptx", annotations=True).read_bytes()
        self.legacy = ReferenceDocuments(self.directory)
        self.files = {"owner": [], "other": []}
        self.calls = []
        self.imports = 0
        self.user = {"id": "owner-id", "username": "owner"}
        self.request = SimpleNamespace(url=SimpleNamespace(scheme="https"),
            headers={"host": "memo.test"}, cookies={"memo_session": "private-test-session"})

    def tearDown(self):
        self.temp.cleanup()

    def add(self, identifier="course", kind="pdf", name="Cours.pdf"):
        row = dict(id=identifier, name=name, kind=kind, folderId="moodle", size=len(self.pdf),
            ready=True, updatedAt="2026-10-13T12:00:00Z")
        self.files["owner"].append(row)
        return row

    def adapter(self, user=None, request=None, legacy=None):
        user = user or self.user
        def handler(request):
            self.calls.append((request.method, request.url.path, dict(request.headers), request.content))
            path = request.url.path.removeprefix("/api/library")
            if not path:
                return httpx.Response(200, json={"folders": [{"id": "moodle", "name": "Moodle", "parentId": None}],
                    "files": self.files[user["username"]]})
            if path == "/import/memo":
                self.imports += 1
                identifier = json.loads(request.content)["id"]
                self.add(identifier)
                return httpx.Response(200, json={"imported": True})
            if path == "/files" and request.method == "POST":
                from urllib.parse import unquote
                self.add(request.headers["x-file-id"], name=unquote(request.headers["x-file-name"]))
                return httpx.Response(201, json={"saved": True})
            if path.endswith("/preview"):
                return httpx.Response(200, content=self.pdf)
            if path.endswith("/original"):
                return httpx.Response(200, content=self.pptx)
            return httpx.Response(404, json={"error": "Document introuvable."})
        return LibraryDocuments(self.directory, user, request or self.request, legacy or self.legacy,
            base_url="http://backend:3001", client_factory=lambda **options: httpx.Client(
                transport=httpx.MockTransport(handler), **options))

    def test_listing_pdf_cache_and_access_revalidation(self):
        row = self.add()
        bridge = self.adapter()
        self.assertEqual(bridge.available()["files"][0]["id"], "course")
        metadata = bridge.metadata("course")
        self.assertEqual(metadata["page_count"], 3)
        self.assertTrue(bridge.public(metadata)["library"])
        self.assertTrue(bridge.pdf_path("course").is_file())
        previews = lambda: sum(path.endswith("/preview") for _, path, _, _ in self.calls)
        self.adapter().metadata("course")
        self.assertEqual(previews(), 1)
        row["updatedAt"] = "2026-10-13T13:00:00Z"
        self.adapter().metadata("course")
        self.assertEqual(previews(), 2, "updated Library files refresh the derived cache")
        self.files["owner"].clear()
        with self.assertRaises(DeckError) as missing:
            self.adapter().pdf_path("course")
        self.assertEqual(missing.exception.status, 404, "a cached PDF cannot bypass Library access")
        _, _, headers, _ = self.calls[0]
        self.assertEqual(headers["host"], "memo.test")
        self.assertEqual(headers["cookie"], "memo_session=private-test-session")
        self.assertEqual(headers["x-forwarded-proto"], "https")
        self.assertFalse(any(path.name == "original.pptx" for path in self.directory.rglob("*")))

    def test_powerpoint_notes_comments_and_hidden_slide_alignment(self):
        self.add(kind="powerpoint", name="Cours.pptx")
        metadata = self.adapter().metadata("course")
        annotations = presentation_annotations(self.directory / "Cours.pptx")
        self.assertEqual(metadata["notes"], annotations["notes"])
        self.assertEqual(metadata["comments"], annotations["comments"])
        self.assertEqual(metadata["page_count"], 3)
        self.assertFalse((self.directory / "library-references/owner-id/course/original.pptx").exists())

    def test_legacy_ownership_migration_and_deleted_file_is_not_resurrected(self):
        original = self.directory / "Legacy.pdf"
        original.write_bytes(self.pdf)
        document = self.legacy.create(self.user, original, original.name)
        with self.assertRaises(DeckError):
            self.adapter({"id": "other-id", "username": "other"}).metadata(document["id"])
        self.assertEqual(self.imports, 0)
        self.adapter().metadata(document["id"])
        self.assertEqual(self.imports, 1)
        self.assertTrue(self.legacy.metadata(document["id"])["library_migrated"])
        self.files["owner"].clear()
        with self.assertRaises(DeckError):
            self.adapter().metadata(document["id"])
        self.assertEqual(self.imports, 1)

    def test_compatibility_upload_goes_to_library_and_duplicate_attachments_are_rejected(self):
        source = self.directory / "Upload.pdf"
        source.write_bytes(self.pdf)
        doc = self.adapter().create(self.user, source, "Résumé.pdf")
        self.assertTrue(doc["library"])
        post = next(call for call in self.calls if call[:2] == ("POST", "/api/library/files"))
        self.assertEqual(post[2]["x-library-request"], "1")
        self.assertEqual(post[2]["origin"], "https://memo.test")
        self.assertEqual(post[3], self.pdf)
        self.assertFalse((self.directory / "reference-documents" / doc["id"]).exists())
        with self.assertRaises(DeckError):
            self.adapter().attachments(self.user, [doc["id"], doc["id"]])
        with self.assertRaises(DeckError):
            self.adapter().metadata("../course")

    def test_api_selection_persisted_sets_and_account_isolation(self):
        self.add()
        accounts = Accounts(self.directory)
        for name in ("owner", "other"):
            accounts.create(name, name, PASSWORD, must_change=False)
        repository = MongoDecks(mongomock.MongoClient().memo.sets)
        factory = lambda directory, user, request, legacy: self.adapter(user, request, legacy)
        with patch.dict("os.environ", {"HOMELAB_LIBRARY_URL": "http://backend:3001"}), \
             patch("backend.main.LibraryDocuments", side_effect=factory), \
             TestClient(create_app(auth_enabled=True, require_https=True, data_dir=self.directory,
                 deck_repository=repository), base_url="https://memo.test") as client:
            client.post("/api/auth/login", json={"username": "owner", "password": PASSWORD}, headers=HEADERS)
            self.assertEqual(client.get("/api/library-documents").json()["files"][0]["id"], "course")
            selected = client.post("/api/library-documents/attach", json={"document_ids": ["course"]}, headers=HEADERS)
            self.assertEqual(selected.status_code, 200, selected.text)
            self.assertTrue(selected.json()["documents"][0]["library"])
            saved = client.post("/api/sets", json={"title": "Cours", "cards": [{"term": "Q", "definition": "R"}],
                "document_ids": ["course"]}, headers=HEADERS)
            self.assertEqual(saved.status_code, 201, saved.text)
            deck = saved.json()
            self.assertEqual(deck["documents"][0]["id"], "course")
            self.assertEqual(client.get("/api/reference-documents/course/pdf").status_code, 200)
            self.files["owner"].clear()
            current = client.get(f'/api/sets/{deck["id"]}').json()
            self.assertEqual(current["cards"], deck["cards"])
            self.assertTrue(current["documents"][0]["unavailable"])
            self.assertEqual(client.get("/api/reference-documents/course/pdf").status_code, 404)
            client.post("/api/auth/login", json={"username": "other", "password": PASSWORD}, headers=HEADERS)
            self.assertEqual(client.get("/api/library-documents").json()["files"], [])
            denied = client.post("/api/library-documents/attach", json={"document_ids": ["course"]}, headers=HEADERS)
            self.assertEqual(denied.status_code, 404)
            self.assertEqual(client.post("/api/library-documents/attach", json={"document_ids": ["course"]},
                headers={**HEADERS, "Origin": "https://untrusted.test"}).status_code, 403)


if __name__ == "__main__":
    unittest.main()
