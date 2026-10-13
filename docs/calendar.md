# Calendar

Calendar is the default browser dashboard section. Explicit `?section=...`
links still select their requested section, and TV mode still starts with TV & Movies.
The Calendar navigation item embeds `/calendar/` in a same-origin frame, including
the dashboard's fullscreen view and Escape handling. It works on HTTP and HTTPS.

The source repository is [olivier-hamel/calendar-app](https://github.com/olivier-hamel/calendar-app),
branch `main`. Clone it beside HomeLab as `calendar/`, or set `CALENDAR_SOURCE_DIR`.
Compose builds its Dockerfile and serves it internally on `calendar:4173` without
publishing a port. Caddy strips `/calendar` and limits this route to trusted networks.
Relative asset URLs work under this prefix. `/calendar/healthz` returns `ok`.

For local development, run `npm run dev` in the Calendar checkout alongside
HomeLab's frontend dev server; Vite proxies `/calendar/*` to port 4173.

To update, commit and push Calendar to `main`, pull with `--ff-only` on the server,
then build and recreate only the `calendar` service. HomeLab changes are pushed
to `feat/memo-integration`, pulled on the server's existing deployment branch,
and rolled out by rebuilding and recreating `frontend` after Caddy validation.
The short procedure is in Calendar's [SERVER-UPDATE.md](https://github.com/olivier-hamel/calendar-app/blob/main/SERVER-UPDATE.md).
Routine updates create no backups and preserve existing runtime configuration and volumes.
