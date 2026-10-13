# Calendar

Calendar is the default browser dashboard section. Explicit `?section=...`
links select Calendar, TV & Movies, or Mémo, and TV mode still starts with TV & Movies.
Removed or unknown section names fall back to Calendar. There is no dashboard
top bar; the sidebar contains app navigation and the fullscreen control.
The Calendar navigation item embeds `/calendar/` in a same-origin frame, including
the dashboard's fullscreen view and Escape handling. It works on HTTP and HTTPS.

The source is [apps/calendar](../apps/calendar/README.md) in this repository.
Compose builds its Dockerfile and serves it internally on `calendar:4173` without
publishing a port. Caddy strips `/calendar` and limits this route to trusted networks.
Relative asset URLs work under this prefix. `/calendar/healthz` returns `ok`.

For local development, run `npm run dev` in the Calendar checkout alongside
HomeLab's frontend dev server; Vite proxies `/calendar/*` to port 4173.

All changes use HomeLab's `feat/memo-integration` branch and a single server pull.
Rebuild `calendar` for Calendar changes and `frontend` for dashboard changes.
See [SERVER-UPDATE.md](../SERVER-UPDATE.md) for the procedure.
Routine updates create no backups and preserve existing runtime configuration and volumes.
