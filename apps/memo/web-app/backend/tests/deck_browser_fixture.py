"""Disposable editor browser fixture; never loads private connection settings."""
import atexit
import os
import tempfile
from pathlib import Path

import mongomock
import httpx

from backend.auth import Accounts
from backend.decks import MongoDecks
from backend.main import create_app
from backend.library_documents import LibraryDocuments
from backend.reference_documents import ReferenceDocuments
from backend import main
from backend.tests.document_fixtures import course_pdf, course_pptx
from fastapi.responses import FileResponse
from starlette.routing import Mount

directory = tempfile.TemporaryDirectory(prefix="memo-editor-e2e-")
atexit.register(directory.cleanup)
accounts = Accounts(directory.name)
owner = accounts.create("browser_oli", "Validation Oli", "browser-test-passphrase-123", must_change=False)
accounts.create("browser_max", "Validation Max", "browser-test-passphrase-123", must_change=False)
repository = MongoDecks(mongomock.MongoClient().memo.memo_card_sets)
repository.import_default(owner)
app = create_app(auth_enabled=True, require_https=False, data_dir=directory.name, deck_repository=repository)

course_pdf(Path(directory.name) / "Chapitre.pdf")
course_pptx(Path(directory.name) / "Cours.pptx", annotations=True)

# A private, disposable Library service exercises the real Mémo bridge. These
# originals belong to the fixture, never the user's real library or Gemini.
os.environ["HOMELAB_LIBRARY_URL"] = "http://fixture-library"
references = ReferenceDocuments(directory.name)
library_files = []
for name in ("Cours.pdf", "Annexe.pdf", "Chapitre.pdf", "Cours.pptx"):
    source = Path(directory.name) / ("Cours.pptx" if name.endswith("pptx") else "Chapitre.pdf")
    document = references.create(owner, source, name)
    library_files.append(dict(id=document["id"], name=name, kind="powerpoint" if name.endswith("pptx") else "pdf",
        folderId="course-documents", size=source.stat().st_size, ready=True, updatedAt="2026-10-13T12:00:00Z"))
folders = [dict(id="moodle", name="Moodle", parentId=None),
    dict(id="course", name="INF2705", parentId="moodle"),
    dict(id="course-documents", name="Documents du cours", parentId="course")]


def library_bridge(directory, user, request, legacy):
    def handle(request):
        path = request.url.path.removeprefix("/api/library")
        if not path:
            return httpx.Response(200, json={"folders": folders,
                "files": library_files if user["id"] == owner["id"] else []})
        parts = path.strip("/").split("/")
        if len(parts) == 3 and parts[0] == "files" and any(row["id"] == parts[1] for row in library_files) and user["id"] == owner["id"]:
            if parts[2] == "preview":
                return httpx.Response(200, content=references.pdf_path(parts[1]).read_bytes())
            if parts[2] == "original":
                return httpx.Response(200, content=(Path(directory) / "Cours.pptx").read_bytes())
        return httpx.Response(404, json={"error": "Document introuvable."})
    return LibraryDocuments(directory, user, request, legacy,
        client_factory=lambda **options: httpx.Client(transport=httpx.MockTransport(handle), **options))


main.LibraryDocuments = library_bridge


@app.get("/api/__fixtures/course.pdf")
def sample_pdf():
    return FileResponse(Path(directory.name) / "Chapitre.pdf")


@app.get("/api/__fixtures/course.pptx")
def sample_pptx():
    return FileResponse(Path(directory.name) / "Cours.pptx")


# create_app mounts the production frontend last. Keep that catch-all behind
# these test-only routes, including when a local production build exists.
app.router.routes[:] = [route for route in app.router.routes if not isinstance(route, Mount)] + [
    route for route in app.router.routes if isinstance(route, Mount)]
