# Calendar

A calm, responsive calendar foundation with empty month, week, and day views. No sample events, external account connection, or event storage is included.

## Run locally

Requires Node.js 20 or later. No dependencies to install.

```sh
npm run dev
```

Open http://localhost:4173. Use `PORT=3000 npm run dev` for another port. Run `npm test` for calendar calculations and state checks, and `npm run check` for module syntax.

## Structure

- `dist/index.html`: application entry point and metadata.
- `dist/js/date.js`: DST-safe calendar date arithmetic and formatting.
- `dist/js/state.js`: selected date, view, navigation, and locally saved preferences.
- `dist/js/components/`: independent sidebar, month/timeline views, dialogs, and icons.
- `dist/js/app.js`: shell, event handlers, keyboard shortcuts, and view composition.
- `dist/styles/tokens.css`: theme, spacing, and shared dimensions.
- `dist/styles/app.css`: component styles and responsive layouts.
- `scripts/serve.mjs`: dependency-free static preview server.
- `tests/`: meaningful date, navigation, time zone, and preference checks.

`dist/` is the actual authored static app; there is no build step. Native ES modules keep UI components separate without a framework dependency. For future events, add an event repository module, keep event state separate from navigation, and add event rendering to the view components. The month and timeline views already share civil dates and keys. Server persistence or integrations can be added without changing the core calendar arithmetic.

## Interaction

Select a date in the month grid or mini calendar. Double-click a month date to open the day; the sidebar provides the same action. Previous, next, Today, and Go to date work in every view. `M`, `W`, `D`, `T`, `G`, and `?` are shortcuts; arrows move periods, or move between days when a month date is focused. Preferences support Sunday/Monday week starts and 12/24-hour time. Calendar time uses America/Toronto.
