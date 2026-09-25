# Changelog

Notable changes worth remembering. Task-tag bookkeeping (`T#`/`C#`/`B#`) has been
removed from the source; this file captures the history that explains *why* the
code is shaped as it is.

## 2026-09-24 — CodeReview.md remediation (Phases 1–5)

### Phase 1 — Stop bleeding
- **P0-1:** Pomodoro Start/Pause/Reset buttons no longer die after the first
  state change. The render function now updates text in place instead of
  rebuilding the button DOM on every tick.
- **P1-3 / P1-4:** Weather and Currency "Retry" buttons now work. Fixed via
  grid-level event delegation (the same pattern the rest of the app already uses).
- **P1-2:** Command palette resolves shortcut links by stable index instead of
  label equality, so duplicate labels no longer open the wrong URL. The `items[0]`
  fallback is deleted — a non-matching item is now a no-op with a status message.
- **P1-5:** An intentionally emptied dashboard no longer re-seeds on reload.
  Seeding is gated on a `settings.seeded` flag set during first-run seeding.

### Phase 2 — Correctness & trust
- **P1-1:** Pomodoro timer is now timestamp-based (`endTime` persisted on start;
  each tick computes remaining from wall clock). No more drift in background tabs,
  and a reload mid-session resumes at the correct value. Fast-forwards completed
  sessions if the page was closed across a full session boundary.
- **P1-6:** Removed `aria-live="polite"` from the clock time span and Pomodoro
  countdown so screen readers no longer announce every second. Discrete events
  (Pomodoro completion) still announce via `announceStatus()`.
- **P2-4:** Corrupted saved data is no longer silently wiped. The corrupt payload
  is preserved under a backup key (`STORAGE_KEY.corrupt-<timestamp>`) and an alert
  is shown. A missing `version` field is treated as v1 so migration runs.
- **P2-5:** `importData` now spreads a fresh clone of defaults (`_defaultState()`)
  instead of the live `DEFAULT_STATE` singleton, preventing alias leaks.

### Phase 3 — Guardrails & architecture
- **Tests + ESLint:** Added `package.json` with dev-only ESLint and Node's built-in
  test runner. Unit tests cover `hexToRgb`, `adjustFillForTheme`, `buildSearchUrl`,
  registry `sanitize()`s, `pruneHabitsLog`, and (added in Phase 4)
  `buildProxyStrategies`.
- **P2-8:** The widget registry is now the single source of truth. Each entry owns
  `defaults()`, `render()`, `editFields()`, `applyEdit()`, and `sanitize()`. The
  edit modal is fully generic; per-type save branches are deleted. Adding a new
  widget type requires only a registry entry + its render function.
- **P2-9:** Global-scope coupling eliminated via an IIFE namespace pattern. Each
  file wraps its code in an IIFE that publishes a single API on `window.Dashboard`.
  UMD-style footers make the files `require()`-able in Node tests. Classic `<script>`
  tags preserved (ES modules break `file://` in Chrome/Edge).
- **P2-10:** The two god-files split into `app/` (boot, state, modals, palette,
  dnd, toasts, grid, widget-card) and `widgets/` (one file per type + shared
  helpers). No file exceeds ~500 lines.
- **P2-11:** Default settings defined in exactly one place (`Storage.defaultSettings()`),
  used by the v2→v3 migration backfill, the Reset handler, and any future code.

### Phase 4 — Reliability & accessibility
- **P1-7:** RSS pipeline reworked. `buildProxyStrategies` extracted to a pure
  exported function (unit-tested). Public-proxy fallback is now opt-in behind a
  Settings checkbox (default off). Per-attempt timeout cut from 9 s to 5 s.
  The per-feed error names which strategy failed (`[via: …]` tag).
- **P2-6:** Service-worker install caches assets individually (`cache.add()` per
  URL) instead of the atomic `cache.addAll()`. One missing asset degrades to
  "missing icon" instead of killing the whole offline shell.
- **P2-7:** Stock watchlist skips `time_series` API calls on automatic refreshes
  (sparkline only updates on manual ↻), halving the credit cost. Rate-limit errors
  are distinguished in the status line ("Rate limited — wait a minute").
- **P2-1:** Modal accessible name is now set per dialog (`_setModalTitle()`).
  Screen readers announce "Settings" / "Add New Widget" / "Edit Widget".
- **P2-2:** Focus trap now includes the modal's close (×) button by querying
  focusables from `modalContainer` instead of `modalBody`.
- **P2-3:** Toast "pause on hover" now survives a quick re-hover. The leave timer
  is tracked and cleared on `mouseenter` and in `dismiss()`.

### Phase 5 — Ship it
- **P3-1:** Dead code removed: `promptDueDate()`, weather `lastTemperature`/
  `lastFetchedAt` writes. (Other P3-1 items were already removed in Phase 3.)
- **P3-2:** Dead CSS removed: all `[data-theme="system"]` rules, `.weather-actions`,
  `.stock-symbol`, `.stocks-actions`, `.shortcut-add-wrap`/`.shortcut-add-toggle`,
  `.clock-add-row`/`.clock-add-btn`, no-op `background-image` transition.
  Duplicate `.shortcut-item` rules consolidated.
- **P3-3:** UI consistency: scoped `button:hover` accent; overlay opacity uses the
  CSS variable (affects palette scrim too); `prefers-reduced-motion` media query;
  `env(safe-area-inset-*)` padding on `#app` and `.toast-region`; README ranges
  aligned; keyboard shortcuts documented.
- **P3-4:** Console diagnostics (`WidgetRegistry loaded`, migration log) gated behind
  `?debug=1`. Task-tag bookkeeping comments removed. This CHANGELOG created.

## 2026-09-13 — Service-worker v1→v2 stale-cache incident

The SW was still serving stale cached JS to PWA/HTTP users after T1–T7 changed
all widget files, causing "Unknown widget type" regressions. Fixed by bumping
`CACHE_NAME` and adding the `activate` handler that deletes non-matching caches.
**Lesson:** always bump `CACHE_NAME` on every release (see README Deploy checklist).

## 2026-09 — Earlier notable fixes (from task-tag history)

- **C2:** Timer-leak fix — widget intervals are centrally managed via
  `setWidgetTimer`/`clearWidgetTimer`; re-renders no longer stack duplicate intervals.
- **I4:** Cache-key dedup — the SW's `APP_SHELL` list had a redundant `'./'` entry
  alongside `'./index.html'`, causing duplicate cache entries. Consolidated to one key.
