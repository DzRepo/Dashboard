# Changelog

All notable changes to Personal Dashboard are documented here.

## 2026-09-25 — Code review fixes

### Step 1 — Breakages

- **Undo toasts:** Fixed temporal-dead-zone crash in `showUndoToast` (`app/toasts.js`) by declaring `dismiss` before scheduling timers.
- **Import:** `importData` now returns `{ ok, data, kept, dropped }`; Settings applies imported data into live `state`, reloads IDB background when needed, re-renders, and shows a status toast.
- **Habits:** Edit save preserves existing habit ids via `data-habit-id` and prunes orphaned log entries (`registry.js`).
- **Export:** `exportData` is async and embeds the IndexedDB background `imageDataUrl` when `hasIdbImage` is set.
- **Countdown undo:** `renderCountdown` clears its container before mount; delete-Undo no longer double-renders clock/countdown/pomodoro.
- **Edit row focus:** `wireRowEditor` focuses the newly added row, not the first matching input.

### Step 2 — Safety

- **RSS:** Item links only become anchors when `isValidHttpUrl`; feed label hostname parse is try/caught.
- **Stocks:** Link templates validated as http(s) on Settings save and again at render (falls back to Google Finance).
- **Background:** `#bg-url` uses `escapeAttr`; `applySettings` sets `url("…")` via `CSS.escape` and rejects unsafe schemes; upload hint updated for IndexedDB.
- **Unknown widget type:** Fallback UI uses `textContent` instead of interpolating `widget.type` into HTML.

### Step 3 — Correctness

- **Theme:** `applySettings` removes the previous `matchMedia` listener before attaching a new one.
- **Pomodoro:** Persists on start/pause/reset/session boundary and on `visibilitychange`; sanitize keeps `endTime` when running.
- **Notes:** Flush all `__notesFlush` hooks before wiping the grid; comments corrected.
- **Widget card:** Invalid fill color no longer aborts card construction.
- **addWidget:** Uses `Dashboard.genWidgetId()`.
- **Stocks sanitize:** Keeps change/sparkline/`updatedAt` when valid.
- **Fetch:** Shared `Dashboard.fetchWithTimeout` used by weather, stocks, RSS, and currency.

### Step 4 — Architecture

- **Sanitize shell:** `applyWidgetShell` preserves validated `id` / `icon` / `fillColor` / `fillOpacity` after type sanitize (used by `Storage.sanitizeWidget`).
- **Registry refresh:** Weather, stocks, and RSS expose `refresh()`; header ↻ is driven by the registry instead of hard-coded types.
- **Grid delegation:** Habit cell toggles and RSS refresh use `handleGridClick` (no per-render listeners).
- **APP_SHELL sync:** New test `test/app-shell-sync.test.js` asserts `index.html` scripts match `sw.js` APP_SHELL.
- **Deferred:** Full per-type `registry.js` split left for a follow-up (high churn / conflict risk).

### Step 5 — Hygiene

- **Search rename:** `renderSearch` / `runSearch` are canonical; legacy Perplexity aliases kept.
- **Orphaned footers:** Removed leftover “next widget” comment blocks from split widget files.
- **README:** Points at `app/boot.js`; support matrix for file:// vs HTTP; clarifies runtime vs dev deps.
- **SW:** Cache bumped to `personal-dashboard-v4`; `skipWaiting` + `clients.claim`; network-first for navigations and `*.js`.
- **Tests:** `escape-shell.test.js` covers escaping, `applyWidgetShell`, and toast TDZ smoke.
- **Lists:** Dropped unused `visibleIndex`.
