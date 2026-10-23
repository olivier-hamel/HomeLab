"""Run on the Moodle LXC after copying library_download.py next to server.py.

This idempotently registers the export and exposes Moodle's modification time.
It never reads or changes credentials or network listeners.
"""
from pathlib import Path

root = Path(__file__).resolve().parent
server = root / "server.py"
text = server.read_text()
registration = "from library_download import register_download_tool\nregister_download_tool(mcp, client)\n\n"
marker = 'if __name__ == "__main__":'
if "register_download_tool(mcp, client)" not in text:
    if marker not in text:
        raise SystemExit("Unexpected server.py: registration point missing")
    server.write_text(text.replace(marker, registration + marker))

client = root / "moodle_client.py"
text = client.read_text()
if '"modified": content.get("timemodified", 0)' not in text:
    marker = '"filesize": content.get("filesize", 0),'
    if marker not in text:
        raise SystemExit("Unexpected Moodle client: file metadata marker missing")
    client.write_text(text.replace(marker, marker + '\n                        "modified": content.get("timemodified", 0),'))
print("Original-file tool registered; credentials and listeners unchanged.")
