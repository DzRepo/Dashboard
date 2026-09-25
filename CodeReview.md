# Code Review — Personal Dashboard

**Date:** 2026-09-25  
**Scope:** Full application (classic scripts, `file://`-first local use, optional PWA when served over HTTP)  
**Focus:** Maintainability, unused code, documentation, and systematic widget extensibility

---

## Verdict

The app is a solid local-first dashboard: no build step, classic scripts that load cleanly from disk, a clear `Dashboard` namespace, and a registry that *almost* owns each widget type. Core strengths are real—escape helpers, sanitize-on-import, SW/index sync tests, and graceful `file://` SW skipping.

The main gap versus the stated design goal (“add a widget type systematically”) is that the registry header overclaims. **New interactive types still require edits outside `registry.js`**, especially `app/grid.js` and often `app/modals/edit-widget.js`, plus load-list updates in three places. Cleaning that contract—and documenting it honestly—should be the next architectural priority.

---

## Architecture snapshot

| Layer | Role |
|---|---|
| `index.html` | Shell markup + ordered classic `<script>` tags |
| `storage.js` | Creates `Dashboard`; localStorage + IndexedDB; migrations; import/export |
| `widgets/shared/helpers.js` | Timers, escaping, fetch timeout, empty-state helpers |
| `widgets/*.js` | One renderer per type; publish `Dashboard.renderX` |
| `registry.js` | Per-type `label` / `defaults` / `render` / `editFields` / `applyEdit` / `sanitize` / optional `refresh` |
| `app/*` | State, grid events, cards, DnD, palette, modals, boot |
| `sw.js` | Optional PWA shell cache (HTTP(S) only) |

Boot order matches the runtime dependency graph and is mirrored in `test/setup.js` and `sw.js` `APP_SHELL` (enforced by `test/app-shell-sync.test.js`).

---

## What works well

1. **`file://` is intentionally supported.** Classic (non-module) scripts avoid CORS-on-modules issues. Service worker registration is gated on `http`/`https` (`app/boot.js`). Background URL handling allows intentional `file:` / absolute paths when already on `file://`.
2. **Registry as the type catalog.** Add-widget buttons, defaults, sanitization, and card refresh buttons are driven from `WidgetRegistry`. Unknown types fail loudly with diagnostics instead of silent fallthrough.
3. **Shared XSS hygiene.** `escapeHtml` / `escapeAttr` live early in the load order and are used widely in renderers and edit templates.
4. **Persistence discipline.** Versioned storage, deep-cloned defaults, IndexedDB for large background blobs, import path runs `sanitize` + `applyWidgetShell`.
5. **Dev safety nets.** `npm test` (40 passing) covers sanitize, search URLs, RSS proxy strategies, shell sync, colors, habits prune. Lint is clean of errors (warnings remain).
6. **Comment quality at module boundaries.** Most files open with a clear purpose and load-order notes; ticket IDs (P2-8, T6, …) preserve decision history.

---

## Findings

Severity guide: **Critical** (broken/wrong for stated goals), **Major** (blocks maintainability or systematic extension), **Minor** (cleanup / clarity), **Nit** (style).

### Critical

_None found for runtime correctness of the shipped widget set under normal use._

### Major

#### M1 — Widget extension path is not systematic (registry overclaim)

`registry.js` documents:

> Adding a new widget = one new entry here + one render function.  
> Zero edits to `app/`, `storage.js`, or widget core logic.

In practice, a new type requires:

| Step | Where |
|---|---|
| Renderer + `Dashboard.render…` publish | `widgets/<type>.js` |
| Registry entry | `registry.js` |
| Script tag | `index.html` |
| Cache list | `sw.js` `APP_SHELL` (test will fail if missed) |
| Test harness load list | `test/setup.js` `WIDGET_FILES` |
| **Often** delegated click/input/keydown | `app/grid.js` (class-name switch) |
| **Often** edit-modal row wiring / immediate-save actions | `app/modals/edit-widget.js` (`if (widget.type === '…')`) |
| Optional CSS | `style.css` |

`openAddWidgetModal` / generic Save/`applyEdit` are registry-driven; **interactive card behavior and list-editors are not**. Examples: lists/search/habits/weather retry live in `grid.js`; clock/stocks/rss/countdown/habits/currency row editors and shortcuts “add link” live as type switches in `edit-widget.js`.

**Recommendation:** Treat the registry entry as the full contract and document it as such. Concrete next steps:

1. Move `wireRowEditor` configs onto the registry (e.g. `entry.rowEditor = { editorId, addBtnId, newRowHtml, focusSelector }`) and call a single loop in the edit modal.
2. Prefer content handlers on the registry or `data-action` + `entry.handleAction(widget, action, ctx)` instead of growing `handleGridClick`.
3. Add a README section “Adding a widget type” listing every touchpoint (honest checklist).
4. Optionally split `registry.js` (~1035 lines) into `registry/<type>.js` or co-locate `editFields`/`sanitize` next to each renderer to keep one mental model per type.

#### M2 — `app/grid.js` is a central bottleneck for interactivity

~200+ lines of `classList.contains` / `closest` branches couple the shell to every interactive widget. New types that need in-card clicks must edit this file; omissions are silent (buttons do nothing).

**Recommendation:** Introduce a small dispatch convention (e.g. `data-widget-action="toggle-habit"` resolved via `getWidgetEntry(type).actions[name]`) so renderers declare behavior next to DOM.

#### M3 — Missing author guide; README underplays disk-load workflow

The product goal is direct disk open. The README currently leads with “serve with Python/Node” and treats `file://` as a caveat. There is no checklist for extending widgets, and it links a non-existent `CHANGELOG.md`.

**Recommendation:** Lead with double-click / `file://` as the primary path; keep HTTP as optional for PWA. Add an “Adding a widget” section (see README update). Drop or restore `CHANGELOG.md`.

### Minor

#### m1 — Unused / dead symbols

| Symbol | Location | Notes |
|---|---|---|
| `getRegisteredTypes()` | `registry.js` | Published on `Dashboard` but never called; callers use `Object.keys(WidgetRegistry)`. |
| `const id = 'widget-' + Date.now()` | `app/boot.js` `addWidget` | Assigned then ignored; real id comes from `genWidgetId()`. |
| `before` | `app/modals/edit-widget.js` clear-completed | Assigned, never read. |
| `widgetId` | `app/grid.js` `handleGridInput` | Assigned, never used. |
| `contentContainer` | `app/grid.js` list-editor keypress branch | Assigned, never used. |
| `label` (catch-up path) | `widgets/pomodoro.js` | Assigned, unused (eslint). |

Remove these or prefix with `_` if intentionally kept for debugging.

#### m2 — ESLint noise from classic-script globals

`app/state.js` globals (`state`, `dashboardGrid`, …) and cross-file functions (`addWidget`, `handleWidgetAction`) are flagged `no-unused-vars` because eslint analyzes files in isolation. They are used; the warnings obscure real dead code (like `id` above).

**Recommendation:** Mark shared globals in `.eslintrc.json` (many already are) or add `/* exported … */` / a thin “globals” comment block so unused *locals* stand out.

#### m3 — Inconsistent registry metadata

Optional fields `hint` and `emptyState` are only set on some types (clock, weather, stocks, countdown, rss, habits). Shortcuts, lists, search, notes, pomodoro, currency omit `hint`, so the add-widget picker looks uneven.

**Recommendation:** Require `hint` (and `emptyState` when the type can be empty) in the documented contract; backfill missing copy.

#### m4 — Dual patterns for in-card behavior

- Pomodoro wires listeners inside `renderPomodoro` (correct for a long-lived control surface).
- Weather / currency / RSS hang `__weatherLocate` / `__currencyRetry` / `__rssRefresh` on the widget object and bounce through `grid.js`.
- Lists / habits mutate state entirely inside `grid.js`.

Three patterns increase cognitive load for anyone adding a type.

**Recommendation:** Document when to use each pattern, or converge on registry actions + optional `bind(widget, container)` called once after render.

#### m5 — `registry.js` size and mixed concerns

One file owns defaults, large HTML edit templates, sanitize, and search URL building. Ticket-era comments are helpful historically but make the “start here to add a widget” story harder to scan.

#### m6 — `clearPomodoroTimer` alias

Thin wrapper around `clearWidgetTimer` exists only for delete-path clarity. Fine, but could be documented as intentional or inlined to reduce API surface.

### Nits

- Ticket IDs in comments (`P2-10`, `C13`, …) are useful archaeology; consider a short “Historical notes” appendix instead of sprinkling them in hot paths once work stabilizes.
- Settings UI scale slider is 75–125%; `applySettings` / save path clamp 50–200. Harmless, but the wider clamp is dead for normal UI.
- `boot.js` `_applyGridColumns` accepts 2–8; Settings only offers 3–6. Align comments/docs with the Settings UI.
- Sparkline SVG builder lives in `widgets/stocks.js`, not `widgets/shared/helpers.js` (README previously said otherwise).

---

## `file://` / no-server checklist

| Concern | Status |
|---|---|
| ES modules / import maps | Not used — good for disk open |
| Relative classic scripts | Yes |
| Service worker | Skipped off HTTP — correct |
| localStorage | Works; origin is the file path (moving the folder can look like a “reset”) |
| IndexedDB (uploaded background) | Generally works; same origin caveat as localStorage |
| Live widgets (weather, stocks, RSS, currency) | Network + CORS still apply from the page origin |
| Background from absolute `/Users/…` path | Supported when page is already `file://` |
| PWA install / offline shell | Requires HTTP(S) |

Call out in docs that **moving or renaming the project folder** can orphan stored data because `file://` origins are path-sensitive in Chromium.

---

## Testing gaps (extension model)

Covered well: sanitize shapes, RSS proxy URL building, search URL, shell↔index sync, storage defaults, color utils, habit prune.

Missing for systematic widgets:

- No test that every registry entry exposes the required methods (`label`, `defaults`, `render`, `editFields`, `sanitize`).
- No test that `test/setup.js` `WIDGET_FILES` matches `index.html` script order (only SW↔index is checked).
- No contract test for optional `refresh` / `applyEdit` / `rowEditor` once those land.

---

## Recommended priority order

1. **Document the real add-widget checklist** (README) — immediate, low risk.
2. **Delete dead locals** (`id`, `getRegisteredTypes` or use it, unused vars) — hygiene.
3. **Registry-drive `wireRowEditor`** — removes most `edit-widget.js` type switches.
4. **Registry/content action dispatch for `grid.js`** — unlocks new interactive types without shell edits.
5. **Split or co-locate registry per type** — once the contract is stable.
6. **Contract unit tests** for registry completeness + setup/index script parity.

---

## Summary table

| Area | Rating | Notes |
|---|---|---|
| Disk / `file://` load | Strong | Classic scripts + SW guard |
| Clean unused API | Fair | Few real dead symbols; eslint noise |
| Documentation | Fair → Good after README fix | Missing widget-author guide; stale CHANGELOG link |
| Systematic new widgets | Weak–Fair | Catalog yes; interactions/edit wiring no |
| Security (XSS / URL) | Strong | Escape + URL allowlists on import |
| Test safety net | Good | Extend with registry contract tests |
