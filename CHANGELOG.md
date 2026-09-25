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
