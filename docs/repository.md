# One repository for all apps

The active repository is `olivier-hamel/HomeLab`, branch `feat/memo-integration`.
The local checkout is `/home/user/Documents/HomeLab`; the server checkout and
Compose project remain `/opt/stacks/homelab`.

| App | Source | Compose service |
| --- | --- | --- |
| Dashboard and TV & Movies UI | `frontend/` | `frontend` |
| TV & Movies API | `backend/` | `backend` |
| Tempo | `apps/calendar/` | `calendar` |
| Memo web app | `apps/memo/web-app/` | `memo` |
| Memo desktop app | `apps/memo/` | Not deployed |

These are regular tracked folders, with no submodules or nested Git repos.
Clone and update HomeLab once; Compose builds services from their folders.
Build paths are fixed in `compose.yml`; older `CALENDAR_SOURCE_DIR` and
`MEMO_SOURCE_DIR` settings are no longer used.

## Preserved history

The import joins each original commit graph without squashing or rewriting:

- HomeLab deployment: `49e18bcbaaca6c2c23f5d254779b37f979e4f5de`.
- Tempo: `603ad047dad822bab222fb8a4ef4ca7b7e521867`.
- Memo: `ff04c33127eb0f8ad3106e7dfad6f921b5d7e06a`.

These commits remain ancestors of the unified branch. Original commits retain
their original paths; use `git show <commit>` or `git log <original-tip>` to read
the pre-import history. Subsequent work uses the folders in the table above.

Old repositories and checkouts are retained as prior sources. Deployment and
new development use HomeLab. Credentials, databases, progress, certificates,
dependencies, and generated builds stay outside Git. Tempo’s `dist/` is
authored source and remains tracked.

See [SERVER-UPDATE.md](../SERVER-UPDATE.md) for the update procedure.
