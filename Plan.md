# Plan — CodeReview.md Remediation

**Source:** [CodeReview.md](CodeReview.md) (2026-09-23, independent pass; item IDs P0/P1/P2/P3 are authoritative for sequencing)
**Date:** 2026-09-24

## How to work through this plan

- **One change at a time.** Each item below is self-contained: make the change, then run its *Validate* checklist before starting the next item.
- **Validation baseline (every item):** double-click `index.html` to load via `file://` — the governing constraint is that everything keeps working with no server. Check console for new errors, and confirm the item's specific *Validate* steps pass.
- **Regression guard:** before touching an area, note what currently works there (the review's "What's already good" section). Escaping discipline, grid-level delegation for lists/shortcuts/search, the widget timer registry (`setWidgetTimer`/`clearWidgetTimer`), and `announceStatus()` must not regress.
- **Git:** item 0 (P3-5) establishes a commit-per-change rhythm so each step lands as a reviewable diff.
- **Status legend:** ☐ not started · ◑ in progress · ✔ done (validated)

---

## Phase 0 — Repo hygiene first (so every later change is a reviewable diff)

### ☐ 0.1 · P3-5 — `git init` + `.gitignore`
**Change:** run `git init`; add a `.gitignore` containing at minimum `.DS_Store/`, and `node_modules/` (for the dev-only tooling in Phase 3); delete or ignore the stray `.DS_Store` at project root; commit a clean baseline.
**Validate:** `git status` is clean after the first commit; `.DS_Store` no longer tracked.

---

## Phase 1 — Stop bleeding (broken control paths + user-visible bugs)

### ☐ 1.1 · P0-1 — Pomodoro Start/Pause/Reset die after first state change
**File:** [widgets.js](widgets.js) `renderPomodoro` (≈L1594–1672)
**Change:** stop rebuilding the buttons on every tick. Keep a static skeleton in `wrap` (mode label, time span, progress-bar fill, session count, both buttons) and update only `textContent` / `style.width` per tick. (This also removes a full `innerHTML` rewrite from the 1 Hz hot path — pairs with P1-1.)
**Validate:** add a Pomodoro widget → press **Start** → timer runs and the visible buttons stay live: **Pause** stops it, **Reset** returns to focus time. Reload the page while running → timer resumes *and* buttons still work. No console errors; no duplicate intervals (check via the existing timer registry behavior).

### ☐ 1.2 · P1-3 + P1-4 — Weather and Currency "Retry" buttons are dead (same root cause as 1.1)
**Files:** [widgets.js](widgets.js) weather `wireButtons`/`renderBody` (≈L889–930); currency `wireButtons`/`renderState` (≈L1906–1918)
**Change:** the retry buttons only exist in error states rendered *after* one-time wiring, so they never have listeners. Fix with the same pattern as 1.1 — either delegate `.weather-retry-btn` / `.weather-locate-btn` / `.currency-retry` clicks at grid level (the pattern the rest of the app already uses), or re-wire inside each render function after every rebuild. Pick one approach and apply it consistently to both widgets.
**Validate:** force a weather fetch failure (e.g., bad coords / network off) → **Retry** re-fetches. Same for currency: force a rate fetch to fail → **Retry** works. Header ↻ icons still work as before (no regression).
**Also:** add the one-paragraph convention note at the top of [widgets.js](widgets.js): *"Render functions must not attach listeners to elements they may re-render; delegate at grid level or update text in place."*

### ☐ 1.3 · P1-2 — Command palette can open the wrong link on duplicate labels
**File:** [app.js](app.js) `_paletteBuildResults` + `_paletteActivate` (≈L2273–2289)
**Change:** carry stable identity through: store the item's index (or per-item id) on each palette result in `_paletteBuildResults`; resolve by that identity in `_paletteActivate`. Delete the `widget.data.items[0]` fallback — when nothing matches, make it a no-op with an `announceStatus()` message instead.
**Validate:** add two shortcuts with the same label (e.g., "GitHub" → github.com, "GitHub" → another URL) → open palette (`⌘K`) → activate each one individually; the correct URL opens every time. An item whose label no longer matches anything does not silently open `items[0]`.

### ☐ 1.4 · P1-5 — Intentionally emptied dashboard re-seeds on reload
**Files:** [app.js](app.js) `init` (≈L110–113), `seedDashboard()` (≈L2094)
**Change:** seed only on true first run. Set `settings.seeded = true` inside `seedDashboard()` and gate seeding on it (or expose a `Storage.hasSavedData()` check). Distinguish "never initialized" from "user deleted every widget".
**Validate:** delete the last remaining widget → reload → dashboard stays empty. Fresh profile (no saved data) still gets seed widgets on first load. Delete-with-Undo within 6 s of a reload no longer resurrects seeds unexpectedly.

---

## Phase 2 — Correctness & trust (timer accuracy, screen readers, storage edge cases)

### ☐ 2.1 · P1-1 — Pomodoro drifts in background tabs; resumes stale after reload
**File:** [widgets.js](widgets.js) `startTick` (≈L1620–1655). Do this in the same function you just restructured in 1.1.
**Change:** make time timestamp-based:
- On start/resume persist `endTime = Date.now() + remainingSec * 1000`; on pause persist the paused remainder.
- Each tick compute `remainingSec = Math.max(0, Math.round((endTime - Date.now()) / 1000))`; the interval becomes a ~250–500 ms render heartbeat, not the time source.
- Derive session completion from that same computation; keep using `setWidgetTimer`/`clearWidgetTimer`.
- On load, if `running && endTime < now`, fast-forward (complete as many sessions as elapsed) instead of silently resuming a stale counter.
**Validate:** start a short focus session, switch tabs for ~30 s → remaining time is correct (no drift). Reload mid-session → resumes at the right wall-clock value. Let a session complete while backgrounded → it completes (and fast-forwards correctly if the page was closed across a full session). Buttons still work after each of these (no regression from 1.1).

### ☐ 2.2 · P1-6 — Screen readers announce clock and Pomodoro every second
**File:** [widgets.js](widgets.js) clock time span (≈L495–496, `aria-live="polite"` + `role="timer"`) and `.pomodoro-time` (≈L1596)
**Change:** remove the explicit `aria-live="polite"` from both (drop or keep `role="timer"` — its implicit live value is off). Discrete events already announce via `announceStatus()` (Pomodoro completion) — keep that.
**Validate:** with a screen reader active, the clock and Pomodoro countdown no longer read out every second; "Pomodoro complete — starting…" is still announced. No change for sighted users (visually hidden behavior unchanged).

### ☐ 2.3 · P2-4 — Corrupted / version-less saved data: silent wipe or skipped migration
**File:** [storage.js](storage.js) `getData` (≈L108–119)
**Change:** treat a missing `version` as 1 (or reject with a clear error) so migration runs. On parse failure, keep the corrupt payload under a backup key (`STORAGE_KEY + '.corrupt-<timestamp>'`) and surface an alert so the user can recover/export it, instead of silently resetting to defaults.
**Validate:** hand-edit localStorage: (a) remove `version` from a saved object → app migrates it correctly on load; (b) corrupt the JSON → app shows a recovery alert, and `STORAGE_KEY.corrupt-<ts>` contains the original payload. Normal load path unchanged (no alert, no backup key created).

### ☐ 2.4 · P2-5 — `importData` spreads the live `DEFAULT_STATE` singleton
**File:** [storage.js](storage.js) (≈L317–322)
**Change:** replace `{ ...DEFAULT_STATE, … }` with `...this._defaultState()` (the existing clone helper). One-line change.
**Validate:** import a payload missing `settings` (or other top-level keys) → nested defaults are clones, not aliases: mutating imported state does not leak into `DEFAULT_STATE`. Subsequent fresh loads still get pristine defaults.

---

## Phase 3 — Guardrails, then architecture (tests → registry SSoT → namespaces → file split)

> Order matters: tests **before** restructuring; P2-8 before P2-9 and P2-10.

### ✔ 3.1 · Tests + ESLint (dev-only) — prerequisite for restructuring
**Change:** add `package.json` with dev-only ESLint + a unit runner (e.g., Node's built-in `node:test`). Cover the pure helpers: `hexToRgb`, `adjustFillForTheme`, `buildSearchUrl`, registry `sanitize()`s, `pruneHabitsLog` (and the proxy-strategy builder once extracted in 4.1).
**Validate:** `npm test` and lint pass on the current codebase; no runtime files are loaded by the page (dev tooling stays out of `file://` loading).

### ✔ 3.2 · P2-8 — Finish making the registry the single source of truth
**Files:** [app.js](app.js) (dead field-render branches ≈L1069–1104; dead `addWidget` fallbacks ≈L2071–2083; per-type save branches in the edit-modal Save handler ≈L1450–1620), [widgets.js](widgets.js) fallback switch (≈L156–170), [storage.js](storage.js) duplicate allow-list (≈L245–260), [registry.js](registry.js)
**Change:** extend the registry entry contract with `applyEdit(widget, formEl)` so each type owns defaults → render → edit UI → save/validate. Make the modal generic (shell + `entry.editFields()` body + danger zone; Save calls `entry.applyEdit`). Delete the per-type save branches and all four dead paths listed in the review.
**Validate (acceptance test from the review):** add a brand-new widget type by touching **only** registry.js (+ its render function). If app.js needs an edit, not done. All 12 existing widget types: add → edit every field of each type in the modal → save → data persists correctly.

### ✔ 3.3 · P2-9 — Kill global-scope coupling (namespace pattern, NOT ES modules)
**Files:** all four `<script>` tags in [index.html](index.html); `window.state` ([app.js:4](app.js#L4)), `window.saveFullState` (≈L846), bare cross-file calls
**Change:** keep classic `<script>` tags (ES modules break `file://` in Chrome/Edge — do not convert). Wrap each file in an IIFE publishing a single namespace: `window.Dashboard` created by the first-loaded file (storage.js), then `Dashboard.Storage`, `Dashboard.WidgetRegistry` (+ `buildSearchUrl`, `genWidgetId`), renderers + shared helpers, and the boot function. Replace every bare global call with a namespaced reference. Keep `window.state` only if something still needs it (after 3.2, nothing should). Add UMD-style footers (`module.exports` guard + `typeof window !== 'undefined' ? window : globalThis`) so the same files are `require()`-able in Node tests.
**Validate:** app loads and works identically via double-click `file://` in Chrome, Edge, Firefox, and Safari. Unit tests from 3.1 still pass (now `require()`-ing the namespaced files). No bare globals remain in cross-file call sites.

### ✔ 3.4 · P2-10 — Split the two god-files (after 3.2/3.3)
**Files:** [app.js](app.js) ≈2,407 lines; [widgets.js](widgets.js) ≈2,027 lines
**Change:** split into `app/` (`boot.js`, `state.js`, `modals/edit-widget.js`, `modals/settings.js`, `palette.js`, `dnd.js`, `toasts.js`) and `widgets/` (one file per widget + `shared/helpers.js`, `shared/timers.js`; RSS pipeline already extracted in 4.1). Update [index.html](index.html) `<script>` tags to load them in dependency order (still classic scripts). Target: no file over ~500 lines; one-line purpose comment at the top of each.
**Validate:** full app works via `file://` after the split (all widget types, modals, palette, drag-and-drop, toasts). Lint + tests still pass. No file exceeds ~500 lines.

### ✔ 3.5 · P2-11 — Default settings defined in three places
**Files:** [storage.js](storage.js) `DEFAULT_STATE` (≈L15–46), v2→v3 migration backfill (≈L160–172); [app.js](app.js) inline object in Reset handler (≈L1935–1940)
**Change:** expose `Storage.defaultSettings()` (clone of the canonical object); use it in all three places. Make `Storage.reset()` return/apply that same shape so the Reset handler stops re-declaring it.
**Validate:** Settings → **Reset** produces a state identical to first-run defaults (including `gridColumns`/`uiScale`, which the inline copy was missing). Migration path for v2 data still backfills correctly.

---

## Phase 4 — Reliability & accessibility

### ☐ 4.1 · P1-7 — RSS: ~45 s worst-case dead time; third-party proxies by default
**File:** [widgets.js](widgets.js) `buildProxyStrategies`, `fetchWithTimeout`, `fetchFeed` (≈L1358–1425)
**Change:**
- Extract `buildProxyStrategies(feedUrl, settings)` to a pure exported function (unit-test placeholder/ordering logic — add tests in 3.1's runner).
- Make public-proxy fallback **opt-in** (Settings checkbox, default off). Default chain: direct → user proxy → fail with the existing actionable message.
- Cut per-attempt timeout to ~5 s; consider racing direct + user proxy in parallel.
- Surface *which* strategy failed per feed (the `label` field already exists) so users can debug their proxy from the card.
- Optional: cache last-good payload + timestamp per feed, rendered with a "cached HH:MM" badge.
**Validate:** with no proxy configured and the network blocked, an RSS card shows its error in ~5–10 s (not 45+). With the opt-in checkbox enabled, public proxies are tried after user proxy. The card names which strategy failed. Existing working feeds (direct or via the README's Cloudflare worker) still load normally from both `file://` and http(s).

### ☐ 4.2 · P2-6 — Service-worker install is all-or-nothing
**File:** [sw.js](sw.js) (≈L47–51)
**Change:** cache items individually — `Promise.all(APP_SHELL.map(u => cache.add(u).catch(warn)))` — so one missing asset degrades to "missing icon" instead of killing the whole offline shell.
**Validate:** (http(s) only — SW doesn't run on `file://`) temporarily rename an icon file → app still installs and works offline with only that asset missing; console shows the per-asset warning, not a total install failure.

### ☐ 4.3 · P2-7 — Stock watchlist vs Twelve Data free-tier math
**File:** [widgets.js](widgets.js) `fetchQuotes` (≈L1095–1180)
**Change:** pick one: skip `time_series` on automatic refreshes (sparkline only on manual ↻), insert a short delay between chunks, or make sparklines opt-in. Also distinguish "rate limited" from other failures in the status line.
**Validate:** a 4-ticker watchlist auto-refreshes without rate-limit failures; the status line says "rate limited, wait a minute" (or equivalent) when that's actually what happened. Sparkline behavior matches the chosen option.

### ☐ 4.4 · P2-1 — Modal accessible name is never set (always "Dialog")
**File:** [index.html](index.html) (`#modal-container` … `aria-labelledby="modal-title"`, hidden `<h2 id="modal-title">Dialog</h2>`)
**Change:** set `modal-title`'s text when opening each modal (one line in the three open functions), or point `aria-labelledby` at the per-modal `<h3>` (give it a stable id).
**Validate:** with a screen reader, opening Settings / Edit Widget / Add Widget announces the correct name (not "Dialog").

### ☐ 4.5 · P2-2 — Focus trap excludes the modal's close button
**File:** [app.js](app.js) `_trapModalFocus` (≈L2035–2047)
**Change:** query focusables from `modalContainer` instead of `modalBody`, so `.modal-close` (×) is included in Tab cycling.
**Validate:** open a modal → Tab cycles through body controls *and* the × button; Shift+Tab wraps back. Esc and backdrop-click close still work (no regression).

### ☐ 4.6 · P2-3 — Toast "pause on hover" doesn't survive a quick re-hover
**File:** [app.js](app.js) `showUndoToast` (≈L2397–2402)
**Change:** store the leave timer in a variable (`let leaveTimer`); clear it on `mouseenter` and in `dismiss()`.
**Validate:** trigger the undo toast → hover it, leave within 2 s, re-hover quickly → toast stays visible while hovered. Repeated quick leave/enter cycles don't stack timers (toast dismisses exactly once after the final 2 s of no hover).

---

## Phase 5 — Ship it (hygiene, dead code, docs)

### ☐ 5.1 · P3-1 — Dead-code inventory
**Change:** delete the verified-unused items listed in CodeReview.md §P3-1: `promptDueDate()` (widgets.js ≈L116–133); weather `lastTemperature`/`lastFetchedAt` writes (≈L709–713); `<textarea type="text">` invalid attribute (≈L1723); dead `timesHtml` variable + archaeology comment (app.js ≈L1106–1108). The four dead paths from P2-8 should already be gone if 3.2 was done correctly — verify and note any that remain (e.g., `createWidgetContent` fallback switch: decide deliberately keep-as-safety-net vs delete).
**Validate:** app works identically via `file://` after deletions; grep confirms each removed symbol is no longer referenced.

### ☐ 5.2 · P3-2 — Dead CSS
**File:** [style.css](style.css)
**Change:** remove the verified-dead selectors from §P3-2: all 9 `[data-theme="system"]` rules; `<body class="theme-system">` in [index.html](index.html); `.weather-actions`; `.stock-symbol`; `.stocks-actions`; `.shortcut-add-wrap`/`.shortcut-add-toggle`; `.clock-add-row`/`.clock-add-btn`. Consolidate the duplicate rules (`.shortcut-item`, `.clock-label-wrap`, second `.habit-remove-entry` color) and remove the no-op `background-image` transition on `#background-overlay`.
**Validate:** visual pass over every widget type and both themes — no styling regressions. No orphaned selectors remain (spot-check with devtools).

### ☐ 5.3 · P3-3 — UI consistency nits
**Files:** [style.css](style.css), [app.js](app.js) `applySettings`, [index.html](index.html)
**Change:** scope the global `button:hover` accent (or give danger/neutral buttons explicit hovers); pick one overlay-opacity mechanism (keep `--overlay-opacity`, drop the inline style) so 0% opacity also affects the palette scrim; add a `prefers-reduced-motion` media query disabling the palette flash + toast slide-in; add `env(safe-area-inset-*)` padding to `#app` and `.toast-region`; align the UI-scale range between README (50–200%) and slider (`min="75" max="125"`), and grid columns between code (2–8) and Settings select (auto/3–6); document existing keyboard reordering in the README.
**Validate:** danger button hover isn't accent-blue; overlay opacity 0% makes the palette backdrop transparent too (or matches chosen mechanism); with reduced motion enabled, animations are disabled; on a notched device (emulated), header/toasts clear the notch.

### ☐ 5.4 · P3-4 — Change-history noise → CHANGELOG.md; gate console output
**Change:** create `CHANGELOG.md` capturing the entries worth keeping (SW v1→v2 stale-cache incident, C2 timer-leak fix, I4 cache-key dedup). Delete task-tag (`T#`/`C#`/`B#`) bookkeeping comments; keep "why" comments. Gate the `console.info` in [registry.js:765](registry.js#L765) and migration log in [storage.js:145](storage.js#L145) behind a debug flag (e.g., `?debug=1`).
**Validate:** normal loads are quiet in the console; appending `?debug=1` shows the diagnostics. CHANGELOG.md exists and is accurate.

### ☐ 5.5 · P3-6 — Service-worker deploy discipline
**Files:** [README.md](README.md), [sw.js](sw.js) (≈L17 `CACHE_NAME`)
**Change:** promote the "bump CACHE_NAME on every release" rule to an explicit **Deploy checklist** section in the README (bump → deploy → hard-refresh once). Consider stale-while-revalidate for JS/CSS so a missed bump degrades gracefully. Keep navigate network-first as-is.
**Validate:** README checklist exists and matches sw.js behavior; (http(s)) a missed cache bump no longer serves stale JS after the SW update.

### ☐ 5.6 · P3-7 — Weather "current hour" timezone assumption
**File:** [widgets.js](widgets.js) hourly-strip matching (≈L806–812)
**Change:** either pass an explicit `timezone` parameter derived from the widget's coordinates (server-side alignment), or add a tooltip on the strip: "hours shown in your local time."
**Validate:** chosen behavior is visible/documented; hourly strip still renders correctly for a widget whose location TZ differs from the viewer's.

### ☐ 5.7 · P3-8 — Import from a newer version passes through unmigrated
**File:** [storage.js](storage.js) `importData` (≈L295–300)
**Change:** if the imported `version > CURRENT_VERSION`, warn ("this export is from a newer version; some features may not work") or reject — don't silently accept.
**Validate:** importing a payload with `version: 99` shows the warning (or is rejected) instead of passing through; normal same-version imports unaffected.

### ☐ 5.8 · P3-9 — Shortcut `href` trusted at render time (defense in depth)
**File:** [widgets.js](widgets.js) `renderShortcuts` (`a.href = item.url`)
**Change:** at render, only set `href` when `/^https?:\/\//i` matches; otherwise render the row without a link.
**Validate:** a hand-edited localStorage state containing a `javascript:` shortcut URL renders as non-clickable text; normal http(s) shortcuts still open correctly.

### ☐ 5.9 · P3-10 — Notes: debounced save lost if a re-render lands in the 300 ms window
**File:** [widgets.js](widgets.js) `renderNotes` (`scheduleSave`)
**Change:** flush the pending value on `blur` (already done) **and** register/clear the debounce with the shared timer registry, or read `ta.value` in a re-render hook.
**Validate:** type into Notes → immediately drag the card (forcing a re-render within 300 ms) → reload → the typed text is persisted.

### ☐ 5.10 · Final pass — README accuracy + full regression
**Change:** align all remaining doc/code mismatches found during the phases above; re-read README against actual behavior.
**Validate (full regression):** fresh `file://` load in Chrome, Edge, Firefox, Safari — every widget type renders and its core interaction works (add/edit/save/delete each); palette (`⌘K`), search, drag-and-drop + arrow-key reorder, toasts/undo, modals (Esc/backdrop/focus trap), settings (theme/overlay/grid/scale/reset/import/export) all work. Console clean on normal load. Lint + unit tests pass. `git log` shows one commit per plan item.

---

## Out of scope / watch-outs (from the review's cross-check)

- **REVIEW.md #2 "habit listener stacking"** is *not* a live bug in current code — do not "fix" it. It's latent fragility covered by the convention note added in 1.2; if an in-place re-render path is ever added for habits, revisit then.
- **ES modules:** explicitly rejected (breaks `file://` in Chrome/Edge). The namespace pattern in 3.3 is the agreed approach; only revisit if the project moves to http(s)-only deployment (a product decision).
- **CSP / threat model:** keep as a README section, not blocking code (local-only threat model; P3-9 covers the one cheap render-time gap).
