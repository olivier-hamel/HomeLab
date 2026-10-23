"""Mémo references the account's HomeLab library; only derived reader PDFs cache locally."""
import hashlib
import json
import os
import re
import tempfile
import threading
import uuid
from pathlib import Path

import httpx
from pypdf import PdfReader
from pypdf.errors import PyPdfError

from .decks import DeckError
from .reference_documents import ReferenceDocuments, MAX_DOCUMENTS, MAX_PAGES, presentation_annotations, convert_office

MAX_BYTES = 25 * 1024 * 1024
LOCK = threading.RLock()


def safe_id(value):
    if not isinstance(value, str) or not re.fullmatch(r"[a-zA-Z0-9_-]{1,80}", value):
        raise DeckError(404, "Document introuvable.")
    return value


class LibraryDocuments:
    def __init__(self, directory, user, request, legacy, base_url=None, client_factory=httpx.Client):
        self.directory = Path(directory) / "library-references" / safe_id(user["id"])
        self.user = user
        self.legacy = legacy
        self.base_url = (base_url or os.environ.get("HOMELAB_LIBRARY_URL", "")).rstrip("/")
        self.client_factory = client_factory
        protocol = request.url.scheme
        host = request.headers.get("host", "")
        self.headers = {"Cookie": "memo_session=" + request.cookies.get("memo_session", ""),
                        "Host": host, "X-Forwarded-Proto": protocol, "Origin": f"{protocol}://{host}"}
        self.index = None

    def call(self, path, method="GET", payload=None, content=None, headers=None, binary=False):
        if not self.base_url:
            raise DeckError(503, "La connexion à Bibliothèque n’est pas configurée.")
        outgoing = dict(self.headers)
        if method != "GET":
            outgoing.update({"X-Library-Request": "1", "Content-Type": "application/json"})
        outgoing.update(headers or {})
        try:
            with self.client_factory(timeout=120, follow_redirects=False) as client:
                with client.stream(method, self.base_url + "/api/library" + path, headers=outgoing,
                                   **({"content": content} if content is not None else {"json": payload} if payload is not None else {})) as response:
                    data = bytearray()
                    for chunk in response.iter_bytes():
                        data.extend(chunk)
                        if len(data) > (MAX_BYTES if binary else 8 * 1024 * 1024):
                            raise DeckError(413, "Ce document est trop volumineux.")
                    if response.status_code >= 300:
                        message = "Bibliothèque est indisponible. Réessaie dans un instant."
                        try:
                            message = json.loads(data).get("error") or message
                        except ValueError:
                            pass
                        status = response.status_code if response.status_code in (400, 401, 403, 404, 409, 413, 429) else 503
                        raise DeckError(status, message)
                    return bytes(data) if binary else json.loads(data)
        except (httpx.HTTPError, ValueError):
            raise DeckError(503, "La connexion à Bibliothèque est indisponible. Réessaie dans un instant.") from None

    def listing(self):
        if self.index is None:
            self.index = self.call("")
        return self.index

    def available(self):
        data = self.listing()
        return {"folders": data["folders"], "files": [{key: row[key] for key in
                ("id", "name", "kind", "folderId", "size", "ready")} for row in data["files"]]}

    def _folder(self, identifier):
        return self.directory / safe_id(identifier)

    def metadata(self, identifier):
        identifier = safe_id(identifier)
        file = next((row for row in self.listing()["files"] if row["id"] == identifier), None)
        if file is None:
            # Old Mémo attachments are migrated lazily with proof of ownership;
            # import/memo explicitly bypasses automatic scans for existing files.
            try:
                old = self.legacy.metadata(identifier)
            except DeckError:
                raise DeckError(404, "Ce document n’est plus disponible dans Bibliothèque.") from None
            if old["owner_id"] != self.user["id"]:
                raise DeckError(404, "Document introuvable.")
            if old.get("library_migrated"):
                raise DeckError(404, "Ce document a été retiré de Bibliothèque.")
            self.call("/import/memo", "POST", {"id": identifier})
            self.index = None
            file = next((row for row in self.listing()["files"] if row["id"] == identifier), None)
            if file is None:
                raise DeckError(404, "Le document n’a pas pu être retrouvé dans Bibliothèque.")
            old["library_migrated"] = True
            (self.legacy._folder(identifier) / "metadata.json").write_text(json.dumps(old, ensure_ascii=False))
        if not file["ready"]:
            raise DeckError(409, "Ce document est encore en cours de téléchargement dans Bibliothèque.")
        folder = self._folder(identifier)
        with LOCK:
            metadata_path = folder / "metadata.json"
            try:
                cached = json.loads(metadata_path.read_text())
            except (OSError, ValueError):
                cached = None
            if cached and cached.get("library_updated_at") == file["updatedAt"] and (folder / "document.pdf").is_file():
                return cached
            pdf = self.call(f"/files/{identifier}/preview", binary=True)
            self.directory.mkdir(parents=True, exist_ok=True)
            with tempfile.TemporaryDirectory(prefix="reader-", dir=self.directory) as temporary:
                work = Path(temporary)
                source = work / "document.pdf"
                source.write_bytes(pdf)
                try:
                    reader = PdfReader(source)
                    if reader.is_encrypted:
                        raise DeckError(400, "Les PDF protégés par mot de passe ne sont pas pris en charge.")
                    count = len(reader.pages)
                except (PyPdfError, ValueError, OSError):
                    raise DeckError(400, "Ce PDF est endommagé ou illisible.") from None
                if not 1 <= count <= MAX_PAGES:
                    raise DeckError(400, f"Le document doit contenir entre 1 et {MAX_PAGES} pages.")
                notes, comments = [], []
                try:
                    old = self.legacy.metadata(identifier)
                    if old["owner_id"] == self.user["id"]:
                        notes, comments = old.get("notes", []), old.get("comments", [])
                except DeckError:
                    pass
                kind = Path(file["name"]).suffix.lower()[1:]
                if file["kind"] == "powerpoint":
                    original = work / ("original." + kind)
                    original.write_bytes(self.call(f"/files/{identifier}/original", binary=True))
                    if kind == "ppt":
                        original = convert_office(original, work, "pptx:Impress MS PowerPoint 2007 XML")
                    annotations = presentation_annotations(original)
                    notes, comments = annotations["notes"], annotations["comments"]
                if notes and len(notes) != count:
                    raise DeckError(422, "L’aperçu n’a pas conservé toutes les diapositives de cette présentation.")
                metadata = {"id": identifier, "owner_id": self.user["id"], "name": file["name"], "kind": kind,
                            "page_count": count, "notes": notes, "comments": comments,
                            "library_updated_at": file["updatedAt"], "library": True,
                            "sha256": hashlib.sha256(pdf).hexdigest()}
                folder.mkdir(parents=True, exist_ok=True)
                # This cache contains a reader/validation PDF; Library is still
                # checked on every request before serving any cached content.
                (folder / "document.pdf").write_bytes(pdf)
                metadata_path.write_text(json.dumps(metadata, ensure_ascii=False))
                return metadata

    @staticmethod
    def public(metadata):
        return {**ReferenceDocuments.public(metadata), "library": True,
                **({"unavailable": True} if metadata.get("unavailable") else {})}

    def attachments(self, user, identifiers):
        if len(identifiers) > MAX_DOCUMENTS or len(set(identifiers)) != len(identifiers):
            raise DeckError(400, f"Choisis au maximum {MAX_DOCUMENTS} documents différents.")
        for identifier in identifiers:
            self.metadata(identifier)

    def authorize(self, user, identifier, repository, set_id=None):
        return self.metadata(identifier)

    def details(self, deck):
        documents = []
        for identifier in deck.get("document_ids", []):
            try:
                documents.append(self.public(self.metadata(identifier)))
            except DeckError as error:
                if error.status not in (403, 404):
                    raise
                documents.append({"id": identifier, "name": "Document indisponible dans Bibliothèque", "kind": "pdf", "page_count": 1, "library": True, "unavailable": True})
        return {**deck, "documents": documents}

    def pdf_path(self, identifier):
        self.metadata(identifier)
        return self._folder(identifier) / "document.pdf"

    def create(self, user, source, name):
        if source.stat().st_size > MAX_BYTES:
            raise DeckError(413, "Chaque fichier de Bibliothèque est limité à 25 Mo.")
        identifier = uuid.uuid4().hex
        from urllib.parse import quote
        self.call("/files", "POST", content=source.read_bytes(), headers={"Content-Type": "application/octet-stream",
                  "X-File-Id": identifier, "X-File-Name": quote(name), "X-File-Folder": ""})
        self.index = None
        return self.public(self.metadata(identifier))
