# Use the ChatGPT bridge from an app on the same LAN

The bridge provides an authenticated JSON API for conversations, asynchronous
messages, run status, action decisions and cancellation. It uses the existing
ChatGPT browser session; no OpenAI API key is needed. Responses are complete
messages, without token streaming.

The API accepts loopback clients and clients in the **private LAN subnet you
configure**. It checks the socket IP address, ignores forwarded-IP headers and
rejects other subnets even when the bearer token is valid. Use the actual subnet
and mask of your LAN, rather than allowing every private network.

## Configure LAN access

For example, if the bridge VM is `192.168.1.50` and your LAN is `192.168.1.0/24`,
add these settings to `.env` (local install) or `/etc/chatgpt-bridge/bridge.env`
(systemd install):

```dotenv
BRIDGE_HOST=0.0.0.0
BRIDGE_LAN_CIDRS=192.168.1.0/24
BRIDGE_ALLOWED_HOSTS=192.168.1.50
```

Restart the service after changing configuration. `BRIDGE_HOST` accepts
`127.0.0.1` (default), `0.0.0.0` (IPv4 LAN) or `::` (dual-stack LAN). Both LAN
listeners require `BRIDGE_LAN_CIDRS`. Only RFC 1918 IPv4 subnets and IPv6 ULA subnets
are accepted. Loopback remains allowed so the CLI works. With no LAN settings,
the API listens on `127.0.0.1` and accepts only loopback clients.

Loopback names and `BRIDGE_ALLOWED_HOSTS` are accepted as HTTP hosts. To also use
a local DNS name, include it without a scheme or port:

```dotenv
BRIDGE_ALLOWED_HOSTS=192.168.1.50,chatgpt-bridge.home.arpa
```

Allow TCP port `3211` from the same subnet in the VM firewall if needed. Keep
the port off the Internet and do not expose it through a public reverse proxy:
a proxy replaces the client's socket address. Engine, VNC and noVNC listeners
stay on loopback. Maintenance routes accept local non-browser clients only;
continue using the CLI over SSH to log in to ChatGPT.

Every route except `GET /healthz` requires:

```http
Authorization: Bearer YOUR_BRIDGE_TOKEN
```

The token is generated in `.local-data/api-token`, or
`/var/lib/chatgpt-bridge/api-token` on the VM. Provision it privately to your app
backend or a trusted personal native client. It grants access to the bridge's
shared conversations and actions; there is no per-user isolation.

For a browser app, keep this token in its backend when possible. If a trusted
personal browser app calls the bridge directly, explicitly allow its origin:

```dotenv
BRIDGE_ALLOWED_ORIGINS=http://192.168.1.20:3000
```

Origins are exact, including scheme and port, with no trailing slash or path.
Comma-separated origins are supported; wildcards and `null` are rejected.
Allowed origins still require the bearer token and a LAN source IP. CORS
preflight allows `Authorization`, `Content-Type` and `Idempotency-Key`; browser
maintenance requests remain blocked. An HTTPS page needs an HTTPS API endpoint
on the LAN to avoid mixed-content restrictions; browser local-network permission
may also be required.

## HTTP flow

Use `http://192.168.1.50:3211` as the API root. Supply the token privately as
`BRIDGE_TOKEN` in these examples.

```sh
# Optional readiness check; session must be ready before sending a message.
curl --fail-with-body http://192.168.1.50:3211/v1/status \
  -H "Authorization: Bearer $BRIDGE_TOKEN"

# 1. Create a conversation. Save the returned id.
curl --fail-with-body http://192.168.1.50:3211/v1/conversations \
  -H "Authorization: Bearer $BRIDGE_TOKEN" \
  -H 'Content-Type: application/json' -d '{"title":"My app"}'

# 2. Send a message. Save the run_id from the 202 response.
curl --fail-with-body http://192.168.1.50:3211/v1/conversations/CONVERSATION_ID/messages \
  -H "Authorization: Bearer $BRIDGE_TOKEN" \
  -H 'Content-Type: application/json' -H 'Idempotency-Key: unique-message-uuid' \
  -d '{"text":"Hello"}'

# 3. Poll until the run needs input or finishes.
curl --fail-with-body http://192.168.1.50:3211/v1/runs/RUN_ID \
  -H "Authorization: Bearer $BRIDGE_TOKEN"
```

Reuse the conversation ID for follow-up messages. Use a new idempotency key for
each message, and preserve that key for recovery if its POST response is lost.
Repeating the same conversation, text, attachments and key returns the original run;
changing the conversation, text, file order, filename, MIME type or file contents
with that key returns `409`.

## Document attachments

Add an optional `attachments` array to the existing JSON message POST. Each entry
contains a `filename` (a basename, never a host path) and canonical `data_base64`
without a `data:` prefix or whitespace. `mime_type` is optional; when supplied it
must match the filename extension. The service infers it otherwise.

```json
{
  "text": "Summarize these notes",
  "attachments": [
    { "filename": "notes.txt", "data_base64": "SGVsbG8K" }
  ]
}
```

The bridge allows **four files, 10 MiB per file and 20 MiB combined** (decoded
bytes). Empty files, duplicate filenames, paths, malformed base64 and unsupported
extensions are rejected before queuing. The text question is still required.
Supported extensions are `.pdf`, `.doc`, `.docx`, `.odt`, `.rtf`, `.xls`, `.xlsx`,
`.ppt`, `.pptx`, `.txt`, `.md`, `.csv`, `.tsv`, `.json`, `.html`, `.xml`, `.yaml`,
and `.yml`. The gateway preserves the original file bytes and filename; it does
not extract text or accept URLs or filesystem paths from API callers.

ChatGPT supports [attaching source files](https://learn.chatgpt.com/docs/use-chatgpt).
Its account limits and file acceptance still apply. The bridge waits for the
filenames in the composer, no upload progress indicators, and an enabled Send
control before submitting once. A rejected or unconfirmed upload is never sent
as a text-only question and is never automatically retried.

Documents are persisted in the private SQLite database with the queued run, so
queued uploads survive restarts. They remain in local backups and are also
uploaded to the ChatGPT account. Run responses and user messages expose only
`attachments: [{ filename, mime_type, size_bytes, sha256 }]`, with an empty array
for text-only messages. Tool approval/denial continuations reuse the remote
conversation without re-uploading documents.

For local files, the CLI handles base64 encoding:

```sh
npm run cli -- ask --attach ./report.pdf --attach ./notes.docx "Summarize these files"
```

| Run status | App behavior |
| --- | --- |
| `queued`, `running` | Poll again, typically after one second. |
| `awaiting_approval` | Show pending action names and arguments for a human decision. POST `{"approved":true}` or `false` to `/v1/actions/ACTION_ID/decision`, then resume polling the same run. |
| `completed` | Display `answer`. |
| `failed` | Display `error.code` and `error.message`. |
| `cancelled`, `interrupted` | Stop polling. If `error.may_have_been_sent` is true, inspect the remote conversation before sending anything again. |

`POST /v1/runs/RUN_ID/cancel` cancels locally; it cannot retract an already
submitted ChatGPT message. One run per conversation may be active at a time.
`GET /v1/conversations` lists conversations; `GET /v1/conversations/ID` returns
ordered history. Assistant history content contains the raw protocol envelope;
use the run's `answer` for the final text displayed in your app.

Errors use `{"error":{"code":"...","message":"..."}}`. Common HTTP statuses
are `400` (invalid input), `401` (token), `403` (LAN/host/origin restrictions),
`404` (unknown ID), `409` (busy conversation or idempotency/decision conflict),
`413` (HTTP body too large), `429` (queue full) and `503` (maintenance). The full contract is
[openapi.yaml](openapi.yaml), also served at authenticated `GET /v1/openapi.yaml`.

## JavaScript / TypeScript client

`src/app-client.ts` and `src/api-types.ts` have no runtime dependencies. Copy
both into your app, or run `npm run build` and copy the matching
`dist/app-client.js`, `dist/api-types.js` and their `.d.ts` files. A local package
dependency can import `chatgpt-plus-bridge/client` after the bridge is built.
The client needs Fetch, AbortController and AbortSignal.throwIfAborted.

```ts
import { ChatGptBridgeClient, BridgeApiError } from './app-client.js';

// Obtain token from private server configuration or native secure storage.
const bridge = new ChatGptBridgeClient({
  baseUrl: 'http://192.168.1.50:3211',
  token,
});

const conversation = await bridge.createConversation('My app');
const requestKey = crypto.randomUUID(); // persist with the conversation before POST
const submission = await bridge.sendMessage(conversation.id, 'Hello', {
  idempotencyKey: requestKey,
});
// Persist submission.run_id before waiting, to resume after an app restart.
let run = await bridge.waitForRun(submission.run_id);
if (run.status === 'completed') console.log(run.answer);
if (run.status === 'awaiting_approval') {
  const pending = run.actions.find(action => action.status === 'pending')!;
  // Display pending.name and pending.arguments in your app's decision UI.
  // After a human chooses, call decideAction(pending.id, approved),
  // then waitForRun(submission.run_id) again.
}
```

For documents, pass the JSON entries in `SendOptions.attachments`:

```ts
import { readFile } from 'node:fs/promises';

// Node.js example; in a browser, encode the selected File with FileReader.
const bytes = await readFile('./report.pdf');
const submission = await bridge.sendMessage(conversation.id, 'Summarize this PDF', {
  idempotencyKey: crypto.randomUUID(),
  attachments: [{ filename: 'report.pdf', data_base64: bytes.toString('base64') }],
});
```

The client also exposes `status`, `listConversations`, `getConversation`,
`getRun`, `cancelRun` and `decideAction`. Methods accept an optional
`{ signal }`; `waitForRun` also accepts `timeoutMs` (default eleven minutes)
and `pollIntervalMs` (default one second). Per-request timeout defaults to
45 seconds and is configurable as `requestTimeoutMs` in the constructor.
Aborting or timing out a wait only stops polling; use `cancelRun` to request
cancellation on the service.

HTTP and transport failures throw `BridgeApiError`, with `status` (`0` for a
transport failure), `code`, `error` and `mayHaveBeenSent`. Requests are never
automatically retried, and redirects and cookies are disabled. If a message POST
fails ambiguously, explicitly recover with the same idempotency key rather than
creating a new message.
