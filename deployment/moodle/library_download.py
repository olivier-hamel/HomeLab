"""Bounded original-file export for HomeLab, registered on the private Moodle MCP.

Install next to server.py and call register_download_tool(mcp, client). The
existing Moodle client keeps credentials, URL validation and download limits.
"""
from base64 import b64encode
from hashlib import sha256 as digest
from pathlib import Path
from threading import RLock
from time import monotonic

MAX_BYTES = 25 * 1024 * 1024
CHUNK_BYTES = 512 * 1024
_cache = {}
_lock = RLock()


def register_download_tool(mcp, client_factory):
    @mcp.tool()
    def download_file(course_id: int, file_id: str, offset: int = 0,
                      length: int = CHUNK_BYTES, sha256: str = "") -> dict:
        """Download a listed PDF, PPT or PPTX original in bounded base64 chunks.

        Start at offset 0; subsequent requests must use the returned sha256.
        Files are limited to 25 MiB and chunks to 512 KiB. No Moodle writes.
        """
        if (type(course_id) is not int or course_id <= 0 or
                not isinstance(file_id, str) or not 0 < len(file_id) <= 2048 or
                type(offset) is not int or not 0 <= offset <= MAX_BYTES or
                type(length) is not int or not 0 < length <= CHUNK_BYTES):
            raise ValueError("Invalid original-file request.")
        key = (course_id, file_id)
        with _lock:
            now = monotonic()
            for stale in [k for k, value in _cache.items() if value[0] < now]:
                del _cache[stale]
            if offset == 0:
                client = client_factory()
                if not any(c["id"] == course_id for c in client.list_courses()):
                    raise ValueError("Course is not available to this account.")
                file = next((f for f in client._course_files(course_id)
                             if f["id"] == file_id), None)
                if file is None:
                    raise ValueError("File is not available in this course.")
                if Path(file["filename"]).suffix.lower() not in (".pdf", ".ppt", ".pptx"):
                    raise ValueError("Only PDF and PowerPoint originals are supported.")
                if file["filesize"] > MAX_BYTES:
                    raise ValueError("File exceeds the 25 MiB limit.")
                content = client._download(file["_url"])
                if not 0 < len(content) <= MAX_BYTES:
                    raise ValueError("Invalid original-file size.")
                while _cache and (len(_cache) >= 4 or
                        sum(len(v[2]) for v in _cache.values()) + len(content) > 50 * 1024 * 1024):
                    del _cache[next(iter(_cache))]
                _cache[key] = (now + 300, file["filename"], content, digest(content).hexdigest())
            value = _cache.get(key)
            if value is None or (offset and value[3] != sha256) or offset >= len(value[2]):
                raise ValueError("Download expired or changed; restart at offset 0.")
            _, filename, content, checksum = value
            chunk = content[offset:offset + length]
            return {"course_id": course_id, "filename": filename, "filesize": len(content),
                    "offset": offset, "sha256": checksum,
                    "data_base64": b64encode(chunk).decode("ascii"),
                    "eof": offset + len(chunk) == len(content)}

    return download_file
