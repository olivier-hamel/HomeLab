# Calendar

A calm, responsive calendar foundation with a home page for today and empty month, week, and day views. Click a date to open its week, then click a day to open its schedule. No sample events, external account connection, or event storage is included.

## Run locally

Requires Node.js 20 or later. No dependencies to install.

```sh
npm run dev
```

Open http://localhost:4173. Use `PORT=3000 npm run dev` for another port. Run `npm test` for calendar calculations and state checks, and `npm run check` for module syntax.

## Server

HomeLab serves this app at `/calendar/` through a separate Docker service. Calendar is the dashboard's default browser section. See [SERVER-UPDATE.md](SERVER-UPDATE.md) for the commit → push → pull → update procedure.

## Structure

- `dist/index.html`: application entry point and metadata.
- `dist/js/date.js`: DST-safe calendar date arithmetic and formatting.
- `dist/js/state.js`: selected date, view, navigation, and locally saved preferences.
- `dist/js/components/`: independent sidebar, month/timeline views, dialogs, and icons.
- `dist/js/components/home.js`: today's agenda, this week's overview, and calendar shortcuts.
- `dist/js/components/shell.js`: the shared application shell and breadcrumb navigation.
- `dist/js/app.js`: shell, event handlers, keyboard shortcuts, and view composition.
- `dist/styles/tokens.css`: theme, spacing, and shared dimensions.
- `dist/styles/app.css`: component styles and responsive layouts.
- `dist/styles/home.css`: the home page's own responsive styles.
- `scripts/serve.mjs`: dependency-free static preview server.
- `tests/`: meaningful date, navigation, time zone, and preference checks.

`dist/` is the actual authored static app; there is no build step. Native ES modules keep UI components separate without a framework dependency. For future events, add an event repository module, keep event state separate from navigation, and add event rendering to the view components. The month and timeline views already share civil dates and keys. Server persistence or integrations can be added without changing the core calendar arithmetic.

## Interaction

The app opens on Home, which always describes the actual current day and week in Toronto, even after browsing other dates. View today opens today's hourly schedule. The week's date strip opens individual days; Open this week shows the weekly calendar. Open calendar starts with the month.

Click a date in the month grid or mini calendar to open its week. Click a week heading, all-day area, or hourly column to open that day. The header breadcrumb provides a direct path back to the week, month, or Home. Previous, next, Today, and Go to date work in every calendar view. `H`, `M`, `W`, `D`, `T`, `G`, and `?` are shortcuts; arrows move periods, or move between dates when a month date is focused. Press Enter on a month date to open its week. Preferences support Sunday/Monday week starts and 12/24-hour time. Calendar time uses America/Toronto.

The navigation store keeps the page separate from the calendar's view. `openDate(date, view)` changes the date and view together in one update, so drilling into a day never renders an intermediate view. The home overview currently shows empty states because events have not been added yet; it is an independent component ready for future agenda data.
