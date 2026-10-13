# Personal read-only Moodle connection

HomeLab's backend uses the official [MCP TypeScript SDK](https://ts.sdk.modelcontextprotocol.io/client)
and its Streamable HTTP client. It initializes a new MCP session, discovers the
three required tools (including paginated discovery), performs the requested
read, then terminates and closes the session. A failed connection does not
leave a cached broken session behind.
The newer `list_events` and `list_assignments` tools are discovered when
available and drive [Tempo's deterministic calendar/task synchronization](calendar.md#tâches-et-moodle).
Older connectors can still serve Library files; Tempo reports that these two
additional tools are missing until the connector is updated.

## Access and configuration

Set these values in the existing `backend/.env`, preserving other settings:

```dotenv
MOODLE_MCP_URL=http://127.0.0.1:18000/mcp
MOODLE_ALLOWED_USERS=oli
```

`MOODLE_ALLOWED_USERS` is an explicit, case-sensitive, comma-separated list of
verified HomeLab usernames. An empty list denies everyone. The backend checks
the current Mémo session, password-change requirement, and this allowlist
before connecting to MCP. Choosing another cinema profile does not grant
Moodle access. This is **one personal Moodle account**: every allowed HomeLab
user sees the courses accessible through that account.

No Moodle or OpenAI credential belongs in HomeLab. The MCP endpoint has no
bearer token or OAuth; keep it on the LXC's `127.0.0.1:8000`. Leave the existing
`poly-moodle.service` and OpenAI tunnel service running with their current
configuration. HomeLab adds an independent SSH connection.

## SSH forwarding with Docker

The supplied systemd unit runs SSH in the **backend container's network
namespace**, using the VM's SSH executable and a dedicated VM account/key.
It binds `127.0.0.1:18000` there. This makes the configured MCP URL reachable
from Docker without host networking, published ports, or a LAN listener.
The wrapper watches the backend container PID and reconnects after container
restart/recreation. Root enters the namespace, then drops privileges to
`homelab-moodle` before starting SSH.

On the web app VM, as an administrator:

```bash
sudo useradd --system --user-group --home-dir /var/lib/homelab-moodle \
  --create-home --shell /usr/sbin/nologin homelab-moodle
sudo install -d -m 700 -o homelab-moodle -g homelab-moodle \
  /var/lib/homelab-moodle/.ssh
sudo -u homelab-moodle ssh-keygen -t ed25519 -N '' \
  -C homelab-moodle -f /var/lib/homelab-moodle/.ssh/id_ed25519
sudo cat /var/lib/homelab-moodle/.ssh/id_ed25519.pub
```

Skip account/key creation if they already exist; never replace an existing
private key. Append the public key to `/home/agent/.ssh/authorized_keys` on the
Moodle LXC. Suggested entry (replace the IP and key):

```text
from="<web-app-vm-LAN-IP>",restrict,port-forwarding,permitopen="127.0.0.1:8000",command="/bin/false" ssh-ed25519 <public-key> homelab-moodle
```

Keep `.ssh` owned by `agent` with mode 700 and `authorized_keys` with mode 600.
The entry allows this key to forward only to the MCP listener and prevents
interactive commands, PTYs and agent forwarding. The service requests only a
local forward; its private key stays with the dedicated VM service account.

Pin the LXC's SSH host key in
`/var/lib/homelab-moodle/.ssh/known_hosts`, owned by `homelab-moodle` with mode
600. Obtain/verify its fingerprint through the LXC console (for example
`ssh-keygen -lf /etc/ssh/ssh_host_ed25519_key.pub`) or an already trusted SSH
connection; do not disable host-key verification in the service.

Install the wrapper and unit from the VM's repository checkout:

```bash
sudo install -d /usr/local/libexec
sudo install -m 755 deployment/moodle/homelab-moodle-forward \
  /usr/local/libexec/homelab-moodle-forward
sudo install -m 644 deployment/moodle/homelab-moodle-forward.service \
  /etc/systemd/system/homelab-moodle-forward.service
sudo systemctl daemon-reload
sudo systemctl enable --now homelab-moodle-forward.service
```

Defaults are container `homelab-backend-1` and SSH host `192.168.0.196:22`.
For a different Compose project name, set `MOODLE_BACKEND_CONTAINER` in
`/etc/default/homelab-moodle-forward`. For a native backend, set
`MOODLE_FORWARD_MODE=native`; the SSH forward then binds the VM's loopback.
The supplied Docker unit requires Docker to start; remove that requirement
and its Docker ordering for a native-only VM.

Rebuild/recreate `backend` after configuring its environment, following
[the normal deployment procedure](../SERVER-UPDATE.md). The forward service
retries every five seconds if the container, SSH host or network is unavailable.
SSH keepalives detect a lost connection after roughly 90 seconds. No Docker
Compose networking change is required.

## Backend API

These HomeLab routes are ordinary application routes; the backend translates
them into MCP tool calls. They never proxy arbitrary MCP requests or expose
the transport to browser JavaScript.

| Route | Request | Response |
| --- | --- | --- |
| `GET /api/moodle/status` | HomeLab session | `available`, discovered supported tool names, `personalAccount` |
| `GET /api/moodle/courses` | HomeLab session | `{ courses: [{ id, shortname, fullname }] }` |
| `POST /api/moodle/files` | `{ "course_id": 123 }` | `{ course_id, files: [{ id, filename, mimetype, filesize, section, module }] }` |
| `POST /api/moodle/read` | `{ "course_id": 123, "file_id": "exact-id-from-files" }` | `{ file: { filename, course_id, text, truncated, characters_extracted, note } }` |

POSTs need the same-origin session cookie, `Origin`,
`Content-Type: application/json`, and `X-Moodle-Request: 1`. Course IDs must
come from the course list; file IDs are passed unchanged with the same course.
The backend rechecks both memberships before reading. An unsupported format
or upstream tool error returns a sanitized error; it never returns the private
MCP error body. Responses use `Cache-Control: no-store`. Document text is not
persisted, logged, or sent to Gemini by these routes. [Bibliothèque](library.md)
provides a separate French document explorer and automatically saves A26
PDF/PowerPoint originals through the additional `download_file` MCP tool.

The current server wraps list outputs in `structuredContent.result` and emits
one JSON text block per row. `read_file` returns one JSON text block. The client
prioritizes structured results and handles all JSON text blocks when needed.
It validates the normalized response, including the returned course ID and
50,000-character limit. Downloads are limited to 25 MiB. PDF, DOCX, PPTX and
text formats are supported by the server; OCR is unavailable. The server's
`truncated` and `note` fields are preserved so callers can display those limits.

Calls are limited to 30 requests per minute per authorized account in each
backend process, with a 60-second total connection/operation deadline. No
browser-supplied endpoint, credential, arbitrary tool name or user identity
is accepted.

## Verification and operations

On the Moodle LXC, as `agent` (without restarting either existing service):

```bash
systemctl --user status poly-moodle.service
journalctl --user -u poly-moodle.service -n 30
/home/agent/poly-moodle/.venv/bin/python \
  /home/agent/poly-moodle/deploy/check_server.py
```

From `backend/` in a native installation, `npm run test:moodle` initializes,
discovers all three tools, lists courses/files, and reads one supported file.
It prints only counts, never document text. The production standalone image
includes this checker and its source dependencies. Run it on the web app VM:

```bash
sudo docker compose --project-directory /opt/stacks/homelab exec -T backend \
  node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON scripts/check-moodle.mjs
```

On the web app VM:

```bash
sudo systemctl is-enabled homelab-moodle-forward.service
sudo systemctl status homelab-moodle-forward.service
sudo journalctl -u homelab-moodle-forward.service -n 30
sudo systemctl restart homelab-moodle-forward.service
```

Repeat the MCP checker after restarting the service and after restarting the
backend container. Verify `GET /api/moodle/courses` without a valid session
returns 401, and a valid HomeLab user outside the allowlist receives 403 without
an MCP connection. Also test an expired session and pending password change.
`enable` plus `WantedBy=multi-user.target` provides boot startup; a live reboot
check should be performed during a maintenance window.

`npm test`, `npm run lint`, `npm run typecheck`, and `npm run build` in `backend/`
cover the client lifecycle, actual server response shapes, privacy failures,
course/file pairing, authorization and the production route build.
