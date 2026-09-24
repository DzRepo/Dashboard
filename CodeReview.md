# Code Review — Personal Dashboard

**Date:** 2026-09-23
**Scope:** [index.html](index.html), [app.js](app.js) (2,407 lines), [widgets.js](widgets.js) (2,027 lines), [registry.js](registry.js) (766 lines), [storage.js](storage.js) (348 lines), [sw.js](sw.js) (115 lines), [style.css](style.css) (2,020 lines), [manifest.webmanifest](manifest.webmanifest), [README.md](README.md)
**Method:** Full read of every source file; each finding below was verified against the current code (line numbers are exact unless marked ≈). No changes were made — this is a work plan for the developer.

> **Relationship to [REVIEW.md](REVIEW.md):** a prior review already exists in this folder. This document is an *independent* pass: every claim was re-verified against the code, and this review adds several live bugs the prior pass missed (most notably **P0-1**, a fully broken Pomodoro control path) while correcting one of its items (its #2, "habit listener stacking," is **not** a live bug in the current code — see [Cross-check](#cross-check-against-existing-reviewmd)). Where this review and REVIEW.md overlap, the item IDs here are authoritative for sequencing.

---

## Executive summary

The codebase is in good shape: escaping discipline is consistent, persistence has versioned migrations + import sanitization + IndexedDB offload for large blobs, timer intervals are centrally managed, and the service worker is well-behaved. The problems that remain fall into four buckets:

1. **One fully broken control path (P0-1):** the Pomodoro Start/Pause/Reset buttons stop working as soon as you press Start. Same root-cause family — *a re-render replaces the DOM but listeners were wired once* — silently kills the Weather and Currency **Retry** buttons (P1-3, P1-4).
2. **A handful of user-visible correctness bugs:** palette opens the wrong link on duplicate labels (P1-2), an intentionally emptied dashboard re-seeds itself on reload (P1-5), the Pomodoro drifts in background tabs and resumes stale after a reload (P1-1), screen readers get per-second announcements from the clock and Pomodoro display (P1-6).
3. **One headline feature with a bad failure mode:** RSS can burn ~45 s of serial, third-party-proxy attempts before showing an error (P1-7).
4. **Half-finished architecture:** the widget registry was started as a single source of truth but per-type save logic, dead fallbacks, and global-scope coupling still live in `app.js`/`widgets.js`; the two god-files (≈2,400 / ≈2,000 lines) should be split *after* that consolidation (P2-8…P2-10).

**Counts:** 1 × P0 · 7 × P1 · 11 × P2 · ~10 × P3.

**Severity legend:**
- **P0** — core behavior is broken; fix before anything else.
- **P1** — user-visible bug or reliability/a11y problem with no good workaround.
- **P2** — robustness, accessibility gap, or architecture/maintainability; fix before sharing with peers.
- **P3** — hygiene, dead code, docs, polish.

---

## P0 — broken behavior

### P0-1 · Pomodoro Start/Pause/Reset buttons die after the first state change

**Location:** [widgets.js:1594–1672](widgets.js#L1594) (`renderPomodoro`)

**Problem:** `renderState()` rebuilds the *entire* card body with `wrap.innerHTML = …` — including both buttons. The click listeners are attached **once**, after the initial render, to that first set of button elements:

```js
renderState();                       // creates buttons v1
container.appendChild(wrap);
…
const startPauseBtn = wrap.querySelector('.pomodoro-start-pause'); // v1
startPauseBtn.addEventListener('click', …);                        // wired to v1 only
const resetBtn = wrap.querySelector('.pomodoro-reset');            // v1
resetBtn.addEventListener('click', …);
```

The moment `startTick()` (or any tick) calls `renderState()`, the wired buttons are destroyed and replaced by listener-less clones. The comment at [widgets.js:1657](widgets.js#L1657) — *"attached to the current DOM; re-wired on each render"* — describes behavior that is **not implemented**: nothing ever re-wires.

**Impact (repro):** add a Pomodoro widget → press **Start**. The timer runs, but the visible buttons are now dead: you cannot Pause or Reset from the card. The only escapes are a full re-render (edit another widget, delete/re-add) or reload — and on reload `data.running === true` resumes the timer *with dead buttons again*. A focus timer that can't be paused is a broken widget.

**Fix (pick one):**
1. **Preferred:** don't rebuild the buttons on tick. Keep a static skeleton (mode label, time span, progress bar fill, session count, two buttons) in the DOM and update only `textContent` / `style.width` per tick. This also removes a full innerHTML rewrite from the 1 Hz hot path (pairs with P1-1).
2. Delegate: handle `.pomodoro-start-pause` / `.pomodoro-reset` clicks at the grid level like every other widget interaction (app.js already does this for lists/shortcuts/search), and stop wiring per-render.
3. Minimum: re-run the wiring at the end of every `renderState()` (make the comment true).

---

## P1 — user-visible bugs & reliability

### P1-1 · Pomodoro drifts in background tabs and resumes stale after reload

**Location:** [widgets.js:1620–1655](widgets.js#L1620) (`startTick`)

**Problem:** time is kept as an integer decremented by a 1 s `setInterval`. Browsers throttle timers in background tabs (often to ≥1/min), so a running Pomodoro loses time whenever the tab isn't focused — every skipped tick is permanently lost. Additionally, `data.running`/`remainingSec` are persisted; after a page reload the timer "resumes" from the saved counter without accounting for wall-clock time that passed while the page was closed.

**Fix:** make it timestamp-based:
- On start/resume persist `endTime = Date.now() + remainingSec * 1000` (and the paused remainder on pause).
- Each tick compute `remainingSec = Math.max(0, Math.round((endTime - Date.now()) / 1000))`; the interval becomes a ~250–500 ms render heartbeat, not the time source.
- Derive session completion from that same computation; keep using `setWidgetTimer`/`clearWidgetTimer`.
- On load, if `running && endTime < now`, fast-forward (complete as many sessions as elapsed) instead of silently resuming a stale counter.

### P1-2 · Command palette can open the *wrong* link (duplicate labels)

**Location:** [app.js:2273–2289](app.js#L2273) (`_paletteActivate`, `kind === 'link'`)

**Problem:** palette results for shortcut links carry no stable identity (`id: null` in `_paletteBuildResults`). Activation resolves the item **by label equality**, falling back to `widget.data.items[0]`:

```js
match = widget.data.items.find(it => String(it.label || '') === r.label) ||
        widget.data.items[0];
```

Two shortcuts with the same label ("GitHub", "Inbox") — common in a personal dashboard — make activating one open the *other* URL; with an empty label it opens `items[0]` unconditionally. Wrong-destination navigation from a keyboard-first feature is exactly the kind of thing peers will notice immediately.

**Fix:** carry identity through: store the item's index (or a per-item id) on each palette result in `_paletteBuildResults`, resolve by that in `_paletteActivate`, and delete the `items[0]` fallback (no-op + status announcement instead).

### P1-3 · Weather "Retry" button is dead (same root cause as P0-1)

**Location:** [widgets.js:889–930](widgets.js#L889) (`wireButtons`) + `renderBody()`

**Problem:** `wireButtons()` runs once at mount and wires whatever `.weather-retry-btn` / `.weather-locate-btn` exist *at that moment*. The retry button only exists in the error state, which is rendered by `renderBody()` **after** a failed fetch — i.e., after wiring has already happened. Every subsequent `renderBody()` replaces the button with an unwired clone, so **Retry has no listener in every reachable error state**. (The header ↻ icon works as a workaround because it calls `widget.__weatherRefresh`, which is re-assigned on each render — that asymmetry is a good hint of the pattern.)

**Fix:** same family as P0-1 — either delegate `.weather-retry-btn`/`.weather-locate-btn` clicks at grid level, or re-wire inside `renderBody()` after each rebuild.

### P1-4 · Currency "Retry" button is dead (same root cause as P0-1)

**Location:** [widgets.js:1906–1918](widgets.js#L1906)

**Problem:** `wireButtons()` runs once at mount; the `.currency-retry` button only exists in the error state, which is rendered when `fetchRates()` fails — always after wiring. The retry button therefore never has a listener in any reachable state; a failed rate fetch leaves the user with no in-card recovery (only re-opening Edit or reloading).

**Fix:** delegate `.currency-retry` at grid level, or re-wire inside `renderState()`.

> **Systemic note (P0-1/P1-3/P1-4):** the codebase already solved this problem correctly for most widgets via grid-level delegation (see [What's already good](#whats-already-good-dont-regress)). The three offenders are widgets that wire buttons *directly* and then re-render their own container. A one-paragraph convention note at the top of [widgets.js](widgets.js) — "render functions must not attach listeners to elements they may re-render; delegate at grid level or update text in place" — would prevent regressions.

### P1-5 · An intentionally emptied dashboard re-seeds itself on every reload

**Location:** [app.js:110–113](app.js#L110) (`init`) → [seedDashboard() at app.js:2094](app.js#L2094)

**Problem:** `init()` seeds the starter widgets whenever `state.widgets.length === 0`. That's right for first run, but there is no distinction between "never initialized" and "user deleted every widget": after deleting the last widget (which persists `widgets: []`), a reload resurrects the two seed widgets. A user can never have an empty dashboard across sessions — surprising, and it silently defeats the Delete-with-Undo flow if they reload within the 6 s undo window.

**Fix:** seed only on true first run — e.g., set `settings.seeded = true` inside `seedDashboard()` and gate on it, or seed only when the raw localStorage key does not exist at all (`Storage` could expose `hasSavedData()`).

### P1-6 · Screen readers announce the clock and Pomodoro every second

**Location:** [widgets.js:495–496](widgets.js#L495) (clock time span: `aria-live="polite"` + `role="timer"`) and [widgets.js:1596](widgets.js#L1596) (`.pomodoro-time` with `aria-live="polite"`)

**Problem:** both elements update their text once per second under `aria-live="polite"`. For the clock, `role="timer"` has an implicit `aria-live` of *off* — explicitly setting `polite` overrides that and makes the SR read "10:42, 10:43, …" every second. The Pomodoro display does the same with "24:59, 24:58, …". This is one of the most annoying SR experiences there are and it defeats the otherwise-good `announceStatus()` live region.

**Fix:** remove the explicit `aria-live="polite"` from both (drop or keep `role="timer"` — its default is off). Discrete events already announce correctly via `announceStatus()` (Pomodoro completion does; keep that). If a "read the time on demand" feature is wanted later, use an explicit SR-only action rather than a live region.

### P1-7 · RSS: ~45 s worst-case dead time, third-party proxies by default

**Location:** [widgets.js:1358–1425](widgets.js#L1358) (`buildProxyStrategies`, `fetchWithTimeout`, `fetchFeed`)

**Problem:** per feed, attempts run **serially** — direct → user proxy (if set) → `allorigins` → `corsproxy.io` → `codetabs` — each with a 9 s timeout. Worst case ≈ **45–50 seconds** of "Loading…" before the card shows an error. Two more concerns: (a) user feed URLs are routed through strangers' public proxies by default — flaky *and* a mild privacy smell, and the README's own recommendation is "run your own worker"; (b) `buildProxyStrategies` lives inside the render closure, so its placeholder handling (`{url}` vs trailing-append) is untestable.

**Fix:**
- Extract `buildProxyStrategies(feedUrl, settings)` to a pure exported function (unit-test the placeholder/ordering logic).
- Make public-proxy fallback **opt-in** (Settings checkbox, default off). Default chain: direct → user proxy → fail with the actionable message that already exists.
- Cut per-attempt timeout to ~5 s; consider racing direct + user-proxy in parallel.
- Surface *which* strategy failed per feed (the `label` field already exists) so users can debug their proxy from the card.
- Optional: cache last-good payload + timestamp per feed and render it with a "cached HH:MM" badge — pairs well with the PWA/offline story.

---

## P2 — robustness, accessibility, architecture

### P2-1 · Modal accessible name is never set (always "Dialog")

**Location:** [index.html](index.html) (`#modal-container … aria-labelledby="modal-title"`, `<h2 id="modal-title" class="visually-hidden">Dialog</h2>`)

**Problem:** `aria-labelledby` points at a hidden `<h2>` whose text is the static string "Dialog". No code ever updates it, so screen-reader users hear *Dialog* for Settings, Edit Widget, and Add Widget alike. Each modal already renders a real `<h3>` ("Settings", "Edit Widget", …) in the body.

**Fix:** set `modal-title`'s text when opening each modal (one line in the three open functions), or point `aria-labelledby` at the per-modal `<h3>` (give it a stable id).

### P2-2 · Focus trap excludes the modal's close button

**Location:** [app.js:2035–2047](app.js#L2035) (`_trapModalFocus`)

**Problem:** the trap collects focusables from `#modal-body` only, but `.modal-close` (×) lives in `.modal-content`, a sibling of the body. Tab cycling skips it entirely; keyboard users can only close via Esc or backdrop click (the latter is mouse-only).

**Fix:** query focusables from `modalContainer` instead of `modalBody`. (The palette is a separate element with its own handler — unaffected.)

### P2-3 · Toast "pause on hover" doesn't survive a quick re-hover

**Location:** [app.js:2397–2402](app.js#L2397) (`showUndoToast`)

**Problem:** `mouseleave` schedules an *untracked* 2 s dismiss timer; re-entering the toast clears only `autoTimer`, not that one. Leave-then-re-hover within 2 s still dismisses the toast while it's hovered — and repeated leave/enter stacks multiple timers.

**Fix:** store the leave timer in a variable (`let leaveTimer`), clear it on `mouseenter` and in `dismiss()`.

### P2-4 · Corrupted or version-less saved data: silent wipe / skipped migration

**Location:** [storage.js:108–119](storage.js#L108) (`getData`)

**Problem:** two edge cases:
- A saved JSON object **without `version`** (hand-edited, partial write) makes the migration loop condition `data.version < CURRENT_VERSION` evaluate to `undefined < 5 → false`, so migration is skipped entirely and the raw shape flows into renderers.
- A **parse failure** resets to defaults with only a `console.error` — the user's data is gone without their knowledge.

**Fix:** treat missing `version` as 1 (or reject with a clear error). On parse failure, keep the corrupt payload under a backup key (`STORAGE_KEY + '.corrupt-<ts>'`) and surface an alert so the user can recover/export it.

### P2-5 · `importData` spreads the live `DEFAULT_STATE` singleton

**Location:** [storage.js:317–322](storage.js#L317)

**Problem:** `cleanData = { ...DEFAULT_STATE, … }` shallow-spreads the module singleton instead of using `this._defaultState()` (the clone helper that exists precisely to avoid this — see its doc comment at [storage.js:89–96](storage.js#L89)). If an import ever lacks `settings`/top-level keys, nested references alias the singleton and later mutations leak into "defaults."

**Fix:** use `...this._defaultState()`. One-line change; keeps the invariant documented on `_defaultState()` true everywhere.

### P2-6 · Service-worker install is all-or-nothing (`cache.addAll`)

**Location:** [sw.js:47–51](sw.js#L47)

**Problem:** `cache.addAll(APP_SHELL)` is atomic — if *any* one asset 404s (e.g., someone deletes `maskable-512.png`), the whole install cache silently fails and there is no offline shell at all. The `.catch(warn)` hides it in the console.

**Fix:** cache items individually (`Promise.all(APP_SHELL.map(u => cache.add(u).catch(warn)))`) so one missing icon degrades to "missing icon" instead of "no offline mode."

### P2-7 · Stock watchlist refresh vs. Twelve Data free-tier math

**Location:** [widgets.js:1095–1180](widgets.js#L1095) (`fetchQuotes`)

**Problem:** each symbol costs **two** API calls (quote + time_series). The chunking runs 4 symbols in parallel, so one refresh of a 4-ticker list issues up to 8 concurrent calls — right at the free tier's ~8 credits/minute. Any watchlist >4 tickers will hit rate-limit failures on every refresh (handled gracefully, but the "Could not load live quotes" status will be the norm).

**Fix (pick):** skip `time_series` on automatic refreshes (sparkline only on manual ↻), insert a short delay between chunks, or make sparklines opt-in. Also distinguish "rate limited" from other failures in the status line so users know to wait a minute.

### P2-8 · Finish making the registry the single source of truth

**Location:** [app.js:1069–1104](app.js#L1069) (dead field-render branches), [app.js:2071–2083](app.js#L2071) (dead `addWidget` fallbacks), [widgets.js:156–170](widgets.js#L156) (fallback switch), [storage.js:245–260](storage.js#L245) (duplicate allow-list), plus the per-type save branches in `openEditWidgetModal`'s Save handler ([app.js:1450–1620](app.js#L1450))

**Problem:** the registry pattern was started but never finished. Today, adding a widget type still means edits in **three** places (registry entry + per-type branch in the modal Save handler + …), and there are four dead code paths that exist only because the migration was left half-done:
- `openEditWidgetModal`: the `else if (widget.type === 'search')` and `else if (isClock)` field-render branches are **unreachable** — every registered type has an `editFields()` function, so the first branch always wins. (The *save* branches for those types are live; only the render branches are dead.)
- `addWidget`'s "fallback defaults" block is unreachable for all current types (every type has a registry entry with `defaults()`).
- `createWidgetContent`'s fallback switch duplicates the registry's render mapping.
- `Storage.sanitizeWidget` carries a second allow-list of types that can only be reached if registry.js failed to load — impossible in this app.

**Fix:** extend the entry contract with `applyEdit(widget, formEl)` so each type owns defaults → render → edit UI → save/validate. The modal becomes generic (shell + `entry.editFields()` body + danger zone; Save calls `entry.applyEdit`), and every `if (widget.type === …)` branch in the save handler plus all four dead paths above can be deleted.
**Acceptance test:** add a brand-new widget type by touching only registry.js (+ its render function). If app.js needs an edit, not done.

### P2-9 · Kill global-scope coupling — namespace pattern, not ES modules

**Location:** all four `<script>` tags in [index.html](index.html); `window.state` ([app.js:4](app.js#L4)), `window.saveFullState` ([app.js:846](app.js#L846)), bare cross-file calls (`saveFullState()`, `announceStatus()`, renderer names)

**Problem:** "works" currently means "load order in index.html happens to be right." Implicit globals also block unit testing (closures over global scripts) and any future bundling/minification.

**Why not `<script type="module">`:** the project's governing constraint is double-click `file://` loading with no server. External module scripts are blocked on `file://` in Chrome/Edge (CORS rejection, origin `'null'`; Chromium issue 41378227 — intentional; whatwg/html #8121 requesting support is still open). Firefox/Safari are more permissive, so behavior would be inconsistent across browsers — external modules cannot be relied on for the double-click workflow. (If this project ever moves to http(s)-only deployment, real ES modules become the right choice; that's a product decision.)

**Fix — without a build step, file://-safe:** keep the classic `<script>` tags and wrap each file in an IIFE that publishes a single namespace: `window.Dashboard = {}` created by the first-loaded file (storage.js), then `Dashboard.Storage`, `Dashboard.WidgetRegistry` (+ `buildSearchUrl`, `genWidgetId`), the renderers + shared helpers, and the boot function. Replace every bare global call with a namespaced reference — this mechanically exposes the hidden coupling exactly as imports would. Keep `window.state` only if something still needs it (after P2-8, nothing should).
**Testability without modules:** give pure-helper files a UMD-style footer — `if (typeof module !== 'undefined' && module.exports) { module.exports = Dashboard; }` — and guard the namespace assignment (`typeof window !== 'undefined' ? window : globalThis`) so a Node test runner can `require()` the same files the page loads; in the browser both are no-ops.

### P2-10 · Split the two god-files (after P2-8/P2-9)

**Location:** [app.js](app.js) ≈2,407 lines; [widgets.js](widgets.js) ≈2,027 lines

**Problem:** `app.js` mixes boot/state, settings modal, edit modal, command palette, drag-and-drop, and toasts; `widgets.js` contains all twelve renderers plus shared helpers and the RSS fetch pipeline. Splitting *before* P2-8/P2-9 would just scatter the duplication; after those, it's mechanical.

**Fix:**
- `app/` → `boot.js`, `state.js`, `modals/edit-widget.js`, `modals/settings.js`, `palette.js`, `dnd.js`, `toasts.js`
- `widgets/` → one file per widget + `shared/helpers.js` (escaping, sparkline), `shared/timers.js`, and the RSS pipeline extracted per P1-7
- Target: no file over ~500 lines; one-line purpose comment at the top of each.

### P2-11 · Default settings are defined in three places

**Location:** [storage.js:15–46](storage.js#L15) (`DEFAULT_STATE`), [app.js:1935–1940](app.js#L1935) (inline object in the Reset handler), [storage.js:160–172](storage.js#L160) (v2→v3 migration backfill)

**Problem:** three copies of the "default settings" shape. They have already drifted: `DEFAULT_STATE` includes `gridColumns`/`uiScale`, but the Reset handler's inline object doesn't (it only works because every reader has a runtime fallback). Any future setting added to one copy but not the others silently behaves differently after Reset vs. first run vs. migration.

**Fix:** expose `Storage.defaultSettings()` (clone of the canonical object) and use it in all three places; make `Storage.reset()` return/apply that same shape so the Reset handler stops re-declaring it.

---

## P3 — hygiene, dead code, docs & polish

### P3-1 · Dead-code inventory (verified unused)

| Location | Item | Evidence |
|---|---|---|
| [widgets.js:116–133](widgets.js#L116) | `promptDueDate()` — defined, never called | grep across all files: definition only |
| [widgets.js:709–713](widgets.js#L709) | `widget.data.lastTemperature` / `lastFetchedAt` — written and persisted, never read | grep: writes only |
| [widgets.js:1723](widgets.js#L1723) | `<textarea type="text">` — invalid attribute (no `type` on textarea) | HTML spec |
| [app.js:1072–1104](app.js#L1072) | `else if (widget.type === 'search')` / `else if (isClock)` field-render branches — unreachable | see P2-8 |
| [app.js:1106–1108](app.js#L1106) | `const timesHtml = '';` + archaeology comment | dead variable, never used in template |
| [app.js:2071–2083](app.js#L2071) | `addWidget` fallback-defaults block — unreachable for registered types | see P2-8 |
| [widgets.js:156–170](widgets.js#L156) | `createWidgetContent` fallback switch — unreachable for registered types (decide: keep as deliberate safety net or delete with P2-8) | — |
| [storage.js:245–260](storage.js#L245) | `sanitizeWidget` fallback allow-list — duplicates registry knowledge, unreachable in-app | see P2-8 |

### P3-2 · Dead CSS (verified: no matching markup in any JS/HTML)

| Location | Item |
|---|---|
| [style.css:112, 114, 121, 123, 1001, 1371, 1615, 1998, 2004](style.css#L112) | `[data-theme="system"]` selectors (9 places). `applySettings()` only ever sets `data-theme` to `"dark"` or `"light"` (system is resolved via matchMedia) — these rules can never match. |
| [index.html](index.html) `<body class="theme-system">` | No `.theme-*` selector exists in the CSS; the class is inert. Remove it (and stop implying a third theme state). |
| [style.css:704](style.css#L704) `.weather-actions` | T12 removed the in-card weather buttons; class no longer emitted. (The grouped `.weather-error .weather-retry-btn, .weather-empty button` part is live.) |
| [style.css:792–796](style.css#L792) `.stock-symbol` | Ticker symbol is intentionally hidden in `renderStocks`; class never emitted. |
| [style.css:828–831](style.css#L828) `.stocks-actions` | No markup emits it (refresh moved to header ↻). |
| [style.css:1130–1144](style.css#L1130) `.shortcut-add-wrap`, `.shortcut-add-toggle` | "+ Add link" moved to the Edit page (app.js comment at line 491–493 confirms removal). |
| [style.css:1183–1202](style.css#L1183) `.clock-add-row`, `.clock-add-btn` | Clock time-entry editor moved to the Edit page (registry `editFields`). |

**Duplicate/overlapping rules worth consolidating:** `.shortcut-item` is defined twice (≈line 305, then again with `!important` overrides at ≈1148); `.clock-label-wrap` twice (≈470, ≈1163); `.habit-remove-entry { color: var(--color-danger) }` declared a second time right after its `:hover` rule (≈1596–1608). And [style.css ≈362](style.css#L362): `#background-overlay { transition: background-image 0.5s }` — `background-image` is not animatable; the declaration does nothing.

### P3-3 · UI consistency nits (CSS/JS)

- **Global `button:hover`** ([style.css:136–139](style.css#L136)) turns *every* unstyled button accent-blue on hover — including the red-text **Reset Dashboard** button and neutral "Use theme default" buttons. Scope it (e.g., to a `.btn-primary`-ish class) or give the danger/neutral buttons explicit hovers.
- **Two mechanisms for overlay opacity:** `.background-overlay-content` gets an *inline* `opacity` from JS ([app.js](app.js) `applySettings`) while the CSS var `--overlay-opacity` only feeds the palette scrim ([style.css](style.css) `.palette-overlay`). Consequence: a user who sets overlay opacity to 0% gets a fully transparent command-palette backdrop. Pick one mechanism (recommend: keep the var, drop the inline style).
- **`prefers-reduced-motion`:** not handled anywhere — the palette flash animation and toast slide-in run regardless. Add a media query that disables them.
- **`safe-area-inset-*`:** not used despite `<meta name="viewport" … viewport-fit=cover>` in [index.html](index.html) — on notched devices installed as a PWA, the header/toasts can sit under the notch. Add `env(safe-area-inset-*)` padding to `#app`, `.toast-region`.
- **README/code range mismatch:** README says "UI scale ranges 50–200%" but the slider is `min="75" max="125"` ([app.js:1743](app.js#L1743)); `_applyGridColumns` accepts 2–8 while the Settings select offers auto/3–6. Align code and docs (pick one range, update both).
- **Keyboard reordering already exists** — the drag handle supports ArrowUp/Down/Left/Right ([app.js](app.js), `createWidgetElement` keydown handler). Document it in the README (one line under a "Keyboard shortcuts" note: `/` focus search, `⌘K` palette, arrows on the drag handle to reorder).

### P3-4 · Change-history noise → CHANGELOG.md; gate console output

**Location:** `T#`/`C#`/`B#` task tags and "removed X / was missing" archaeology comments throughout all five JS files; [registry.js:765](registry.js#L765) (`console.info` every load); [storage.js:145](storage.js#L145) (migration log)

**Fix:** create `CHANGELOG.md` capturing the entries worth keeping (SW v1→v2 stale-cache incident, C2 timer-leak fix, I4 cache-key dedup are exactly that kind of history). Keep comments that explain **why** the code is shaped as it is; delete task-tag bookkeeping. Gate the two `console` diagnostics behind a debug flag (e.g., `?debug=1`).

### P3-5 · Repo hygiene before sharing

No git repo and no `.gitignore` exist; a macOS `.DS_Store` is sitting in the project root. Before sharing with peers: `git init`, add a `.gitignore` (`.DS_Store/`, and `node_modules/` if the dev-only tooling from P2-9's companions lands), and commit a clean baseline so the fixes below land as reviewable diffs.

### P3-6 · Service-worker deploy discipline (operational)

**Location:** [sw.js:17](sw.js#L17) (`CACHE_NAME`), README Troubleshooting

The file's own comments record a v1→v2 incident where stale cached JS caused "Unknown widget type" regressions; today the "bump `CACHE_NAME` on every release" rule lives only in a comment. Promote it to an explicit **Deploy checklist** section in the README (bump → deploy → hard-refresh once), and consider stale-while-revalidate for JS/CSS so a missed bump degrades gracefully instead of serving old code. Keep the navigate network-first behavior — it's correct as-is.

### P3-7 · Weather "current hour" timezone assumption (document or fix)

**Location:** [widgets.js ≈806–812](widgets.js#L806) (hourly-strip matching, with an honest comment about the assumption)

The hourly strip matches Open-Meteo hours to "now" assuming viewer TZ == location TZ. Either pass an explicit `timezone` parameter derived from the widget's coordinates so alignment is server-side, or at minimum add a tooltip on the strip: "hours shown in your local time."

### P3-8 · Import from a *newer* version passes through unmigrated

**Location:** [storage.js:295–300](storage.js#L295) (`importData`)

`while ((data.version || 0) < CURRENT_VERSION)` silently accepts `version > CURRENT_VERSION`. Warn ("this export is from a newer version; some features may not work") or reject.

### P3-9 · Shortcut `href` is trusted at render time (defense in depth)

**Location:** [widgets.js](widgets.js), `renderShortcuts` (`a.href = item.url`)

URLs are validated on import (registry `sanitize`) and in the Edit form, but a hand-edited/corrupted localStorage state could carry a `javascript:` URL straight into an anchor. Cheap to close: at render, only set `href` when `/^https?:\/\//i` matches (otherwise render the row without a link). Local-only threat model, but it's two lines.

### P3-10 · Notes: debounced save lost if a re-render lands inside the 300 ms window

**Location:** [widgets.js](widgets.js), `renderNotes` (`scheduleSave`)

If a full re-render happens within 300 ms of the last keystroke (e.g., user types then immediately drags a card), the pending debounced save never fires and those keystrokes are lost. Narrow edge case; fix by flushing the pending value on `blur` (already done) *and* registering/clearing the debounce with the shared timer registry, or by reading `ta.value` in a `beforeunload`/re-render hook.

---

## What's already good (don't regress)

- **Escaping discipline.** `escapeHtml`/`escapeAttr` are applied consistently at every template-built HTML site I checked (titles, labels, URLs in attributes, notes). No injection path found. Keep it enforced — a lint rule or review checklist item when the code is restructured (P2-8/P2-9).
- **Persistence maturity.** Versioned migrations v1→v5, import sanitization per type, and splitting the background image into IndexedDB so it doesn't eat localStorage quota. Better than most local-first apps of this size.
- **Grid-level event delegation** for widget interactions (lists, shortcuts, search) — re-renders can't stack duplicate handlers. This is the correct pattern; P0-1/P1-3/P1-4 are widgets that opted out of it.
- **Widget timer registry** (`setWidgetTimer`/`clearWidgetTimer`) — interval leaks across re-renders are handled for clock/countdown/pomodoro.
- **Service worker hygiene.** Versioned cache, GC of stale caches on activate, cross-origin API traffic deliberately left alone.
- **Accessibility foundations.** Focus trap + Esc handling for modals, `role="option"`/`aria-selected` in the palette, a dedicated status live region (`announceStatus`) used for discrete events, keyboard reordering of cards. P1-6/P2-1/P2-3 are gaps in an otherwise solid base, not a missing foundation.
- **README quality.** Install/PWA instructions, the Cloudflare RSS-proxy worker guide (with hardening notes), and an honest privacy table.

---

## Cross-check against existing REVIEW.md

Verified independently; results:

| REVIEW.md item | Verdict |
|---|---|
| #1 Pomodoro timestamp-based timer | **Confirmed** (P1-1 here). This review adds the stale-resume-after-reload angle and a stronger sibling bug (P0-1). |
| #2 Habit-toggle listener stacking | **Not a live bug in current code.** `renderHabits` adds one listener per container instance; full re-renders create *new* containers (cards are rebuilt in `renderDashboard`), and the toggle path only calls `renderGrid()`, which does not add listeners. It *is* a latent fragility — if anyone later adds an in-place re-render path for habits (like shortcuts/lists have), it becomes a real stacking bug. Keep as "watch out," not a fix item; the convention note in P1-7's systemic callout covers it. |
| #3 Palette wrong link on duplicate labels | **Confirmed** (P1-2 here). |
| #4 No tests/lint/CI | **Confirmed** — no `package.json`, no config of any kind. Add dev-only ESLint + a unit runner for the pure helpers (`hexToRgb`, `adjustFillForTheme`, `buildSearchUrl`, registry `sanitize()`s, `pruneHabitsLog`, proxy-strategy builder once extracted) *before* the P2-8…P2-10 restructuring. |
| #5 Registry as single source of truth | **Confirmed and sharpened** (P2-8 here): the search/clock field-render branches are provably unreachable, and `addWidget`'s fallback block is dead for all current types. |
| #6 ES modules / kill globals | **Confirmed with revision** (P2-9): the goal is right, but ES modules break `file://` loading in Chrome/Edge — revised to a classic-script namespace pattern. See [file:// compatibility check](#file-no-server-compatibility-check). |
| #7 Split god-files after consolidation | **Confirmed** (P2-10). |
| #8 Harden RSS pipeline | **Confirmed and quantified** (P1-7): up to 5 serial attempts × 9 s ≈ 45–50 s worst case. |
| #9 Security/privacy hygiene | **Partially confirmed.** No CSP; key in localStorage (documented, acceptable for local-first); `innerHTML` escaped today. Added P3-9 (render-time href validation) and the CSP/threat-model note stands — keep it a README section rather than blocking code. |
| #10 SW deploy discipline | **Confirmed** (P3-6). README already has a troubleshooting bullet; promote to an explicit checklist. |
| #11 Weather hourly TZ assumption | **Confirmed** (P3-7). |
| #12 Change-history → CHANGELOG.md | **Confirmed** (P3-4). |
| #13 Polish/audit pass | Mostly covered here: a11y gaps (P2-1, P2-2), reduced-motion + safe-area (P3-3). **Correction:** the "keyboard alternative for drag-and-drop is missing" concern does not apply — arrow-key reordering on the drag handle already exists; it just needs documenting (P3-3). |

**New in this pass:** P0-1, P1-3, P1-4 (the "re-render orphans listeners" family), P1-5 (seed resurrection), P1-6 (per-second SR announcements), P2-3, P2-4, P2-5, P2-6, P2-7, P2-11, and the full dead-code/dead-CSS inventory (P3-1/P3-2).

---

## file:// (no-server) compatibility check

The project's governing constraint is that the dashboard keeps working by double-clicking [index.html](index.html) (`file://`, no server). Every recommendation above was audited against that constraint:

| Recommendations | file:// impact |
|---|---|
| P0-1, P1-1…P1-6 (DOM/logic bug fixes: Pomodoro buttons + timer, palette identity, dead Retry buttons, seed re-seed, aria-live) | **None.** Protocol-agnostic DOM and logic changes. |
| P1-7 (RSS pipeline) | **No CORS change.** Direct feed fetches fail identically on `file://` and http (feeds lack CORS headers either way). The user's own Cloudflare Worker and the public proxies send `Access-Control-Allow-Origin: *`, which matches a file page's null origin — so the proxy path works from `file://`. Shorter timeouts and opt-in proxies are pure logic. |
| P2-4/P2-5 (storage edge cases) | **None.** localStorage only — the app already depends on it from `file://`; IndexedDB usage is unchanged (the existing graceful fallback to localStorage stays). |
| P2-6, P3-6 (service worker) | **None.** `sw.js` only runs when served over http(s): registration is already guarded by `location.protocol.startsWith('http')` ([app.js:102](app.js#L102)). These items only make the http(s) path more robust. |
| P2-8 (registry SSoT), P2-10 (file split) | **None — as long as the files stay classic `<script>` tags.** Multiple external scripts load fine from `file://`. |
| P2-9 (global coupling) | **Revised in this pass.** The original "convert to ES modules" fix would have broken `file://` loading in Chrome/Edge; the revised namespace pattern keeps classic scripts. |
| Cross-origin https fetches (weather/stocks/currency/RSS) | **Established pattern, unchanged.** The app already fetches these APIs from `file://` today; no recommendation alters that. |
| Dev tooling (ESLint/tests devDeps, P3-5 git init/.gitignore) | **None.** Never loaded by the page — no runtime impact. |

**Bottom line:** after the P2-9 revision, **every recommendation preserves double-click `file://` loading.** The only features that require http(s) remain the PWA/service-worker ones (installability, offline shell), which is already documented in [README.md](README.md) and unchanged by this review.

---

## Suggested sequencing

| Phase | Items | Demoable outcome |
|---|---|---|
| **1. Stop bleeding** | P0-1, P1-3 + P1-4 (one shared pattern fix), P1-2, P1-5 | Pomodoro is pausable/resettable; Retry buttons work; palette never opens the wrong link; empty dashboard stays empty |
| **2. Correctness & trust** | P1-1 (timestamp timer, same function as P0-1), P1-6, P2-4 + P2-5 (storage edge cases) | Timer accurate in background tabs and across reloads; SR users get sane announcements; corrupt data can't silently wipe state |
| **3. Guardrails, then architecture** | tests + ESLint (dev-only), P2-8 → P2-9 → P2-10, P2-11 | New widget type = one registry entry; explicit single-namespace exports (file://-safe); files ≤ ~500 lines; default state in exactly one place |
| **4. Reliability & a11y** | P1-7, P2-6, P2-7, P2-1…P2-3 | RSS fails fast with a debuggable message; offline shell survives one missing asset; modal naming/focus/toast behavior are correct |
| **5. Ship it** | P3-1…P3-10, README accuracy pass, CHANGELOG.md, git init + .gitignore | Clean history, no dead code, docs match behavior — sign-off ready to share with peers |
