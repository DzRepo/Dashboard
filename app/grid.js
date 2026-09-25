/**
 * app/grid.js — grid-level delegated event handlers. One listener on the stable
 * `dashboardGrid` element dispatches to the right handler based on the clicked/typed
 * element's class, so re-rendering widget content (or the whole dashboard) can never
 * stack duplicate handlers. Covers: click (widget actions + per-type content), live
 * input/change, keypress (Enter/Esc in inputs), global shortcuts (/ and Alt+P), and the
 * shared search runner. Published to Dashboard for boot.js's init().
 */

/**
 * Grid-level delegated click handler.
 *
 * One listener on the stable `dashboardGrid` element dispatches to the right
 * handler based on the clicked element's class. Because the grid element is
 * never re-created, re-rendering widget content (or the whole dashboard)
 * cannot stack duplicate handlers.
 */
function handleGridClick(e) {
    const target = e.target;
    const card = target.closest('.widget-card');
    if (!card || !dashboardGrid.contains(card)) return;

    const widgetId = card.dataset.id;
    const widget = state.widgets.find(w => w.id === widgetId);
    if (!widget) return;

    const contentContainer = card.querySelector('.widget-content');

    // Widget action buttons (Edit / Delete).
    // Resolve from any .action-btn ancestor so the click still works when the
    // user hits an inner element of the button (e.g. the gear <svg>) or a text
    // node — this is what made the settings gear unreliable before.
    const actionBtn = target.closest ? target.closest('.action-btn') : null;
    if (actionBtn && card.contains(actionBtn)) {
        handleWidgetAction(widget, actionBtn.dataset.action);
        return;
    }

    // NOTE: "+ Add link" and its toggle no longer live in the card — they moved to
    // this widget's Edit page (see openEditWidgetModal + WidgetRegistry['shortcuts']).
    // The old delegated branches for .shortcut-add-toggle / .add-shortcut-btn were removed.

    // Shortcuts: delete
    if (target.classList.contains('delete-shortcut-btn')) {
        const index = Number(target.dataset.index);
        widget.data = widget.data || {};
        widget.data.items = widget.data.items || [];
        widget.data.items.splice(index, 1);
        saveFullState();
        Dashboard.renderShortcuts(widget, contentContainer);
        return;
    }

    // Lists: add
    if (target.classList.contains('add-list-btn')) {
        const inputEl = contentContainer.querySelector('.list-input');
        const text = inputEl.value.trim();
        if (text) {
            widget.data = widget.data || {};
            widget.data.items = widget.data.items || [];
            widget.data.items.push({ text, completed: false });
            saveFullState();
            Dashboard.renderLists(widget, contentContainer);
        }
        return;
    }

    // Lists: checkbox toggle (the primary complete/un-complete control)
    if (target.classList.contains('list-item-checkbox')) {
        const index = Number(target.dataset.index);
        widget.data = widget.data || {};
        widget.data.items = widget.data.items || [];
        if (widget.data.items[index]) {
            widget.data.items[index].completed = !widget.data.items[index].completed;
            saveFullState();
            Dashboard.renderLists(widget, contentContainer);
        }
        return;
    }

    // NOTE: "Show completed", "Sort by due date" and "Clear completed"
    // are no longer card controls — they live on this widget's Edit page now.

    // Lists: row click → open the inline editor for due date + note.
    // (The checkbox and × buttons are handled above / below; this branch fires only when the user clicks elsewhere on the row.)
    const listItem = target.closest('.list-item');
    if (listItem && card.contains(listItem) && !target.closest('input, textarea, button')) {
        const index = Number(listItem.dataset.index);
        // Close any other open editors in this widget first.
        contentContainer.querySelectorAll('.list-item-editor').forEach(el => { el.hidden = true; });
        const editor = listItem.querySelector(`.list-item-editor[data-index="${index}"]`);
        if (editor) {
            editor.hidden = false;
            const dueInput = editor.querySelector('input.list-due-input');
            if (dueInput) { dueInput.focus(); }
        }
        return;
    }

    // Lists: save the inline editor for an item.
    if (target.classList.contains('list-editor-save')) {
        const li = target.closest('.list-item');
        const index = Number(li && li.dataset.index);
        widget.data = widget.data || {};
        widget.data.items = widget.data.items || [];
        const item = widget.data.items[index];
        if (item) {
            const editor = li.querySelector(`.list-item-editor[data-index="${index}"]`);
            const dueInput = editor && editor.querySelector('input.list-due-input');
            const noteTa  = editor && editor.querySelector('textarea.list-note-input');
            const dv = (dueInput && dueInput.value) ? dueInput.value.trim() : '';
            item.dueDate = (/^\d{4}-\d{2}-\d{2}$/.test(dv)) ? dv : null;
            if (noteTa) {
                const nv = noteTa.value.trim();
                item.note = nv; // empty string clears the note
            }
        }
        saveFullState();
        Dashboard.renderLists(widget, contentContainer);
        return;
    }

    // Lists: cancel the inline editor (revert to saved values).
    if (target.classList.contains('list-editor-cancel')) {
        const li = target.closest('.list-item');
        const index = Number(li && li.dataset.index);
        widget.data = widget.data || {};
        widget.data.items = widget.data.items || [];
        const item = widget.data.items[index];
        if (li) {
            const editor = li.querySelector(`.list-item-editor[data-index="${index}"]`);
            if (editor) {
                const dueInput = editor.querySelector('input.list-due-input');
                if (dueInput && item) {
                    dueInput.value = (/^\d{4}-\d{2}-\d{2}$/.test(item.dueDate || '')) ? item.dueDate : '';
                }
                const noteTa = editor.querySelector('textarea.list-note-input');
                if (noteTa && item) noteTa.value = item.note || '';
            }
        }
        // Just close the editor; no state change.
        Dashboard.renderLists(widget, contentContainer);
        return;
    }

    // Lists: delete
    if (target.classList.contains('delete-list-btn')) {
        const index = Number(target.dataset.index);
        widget.data = widget.data || {};
        widget.data.items = widget.data.items || [];
        widget.data.items.splice(index, 1);
        saveFullState();
        Dashboard.renderLists(widget, contentContainer);
        return;
    }

    // Clock rows no longer have a per-row delete button; times are managed on the Edit page.

    // Search: run query (uses the configured engine via buildSearchUrl)
    if (target.classList.contains('search-btn')) {
        const inputEl = contentContainer.querySelector('.search-input');
        const query = inputEl.value.trim();
        if (query) {
            runSearch(widget, query);
        }
        return;
    }

    // Search: click a recent-query chip → fill the input and search.
    if (target.classList.contains('recent-chip')) {
        const q = target.dataset.q || '';
        if (!q) return;
        const inputEl = contentContainer.querySelector('.search-input');
        if (inputEl) inputEl.value = q;
        runSearch(widget, q);
        return;
    }

    // Weather: in-card Retry (error state) and "Use my location" (empty state).
    // These buttons only exist in states rendered *after* mount, so they can't be
    // wired once at render time — delegate here instead (P1-3).
    if (target.classList.contains('weather-retry-btn') || target.classList.contains('weather-locate-btn')) {
        if (typeof widget.__weatherLocate === 'function') widget.__weatherLocate();
        return;
    }

    // Currency: in-card Retry (error state) — same delegation pattern (P1-4).
    if (target.classList.contains('currency-retry')) {
        if (typeof widget.__currencyRetry === 'function') widget.__currencyRetry();
        return;
    }

    // Habits: toggle today's cell (grid-delegated so re-renders don't stack listeners).
    const habitCell = target.closest('.habit-cell');
    if (habitCell && habitCell.classList.contains('habit-clickable') && card.contains(habitCell)) {
        widget.data = widget.data || {};
        if (typeof widget.data.log !== 'object' || widget.data.log === null) widget.data.log = {};
        const habitId = habitCell.dataset.habitId;
        const dateKey = habitCell.dataset.dateKey;
        const arr = Array.isArray(widget.data.log[dateKey]) ? widget.data.log[dateKey] : [];
        if (arr.includes(habitId)) {
            widget.data.log[dateKey] = arr.filter(id => id !== habitId);
        } else {
            widget.data.log[dateKey] = arr.concat([habitId]);
        }
        saveFullState();
        Dashboard.renderHabits(widget, contentContainer);
        return;
    }

    // RSS: in-card Refresh.
    if (target.classList.contains('rss-refresh-btn')) {
        if (typeof widget.__rssRefresh === 'function') widget.__rssRefresh();
        return;
    }
}

// ── Delegated input / change handlers for live-updating controls ────────────

/** Live-filter shortcut items as the user types. Hides non-matching rows without a full re-render. */
function handleGridInput(e) {
    const target = e.target;
    if (!target.classList || !target.classList.contains('shortcut-filter')) return;

    const card = target.closest('.widget-card');
    if (!card || !dashboardGrid.contains(card)) return;
    const widgetId = card.dataset.id;
    const query = (target.value || '').trim().toLowerCase();

    // Each .shortcut-item-container holds one link row; hide rows that don't match.
    card.querySelectorAll('.shortcuts-list > .shortcut-item-container').forEach(row => {
        if (!query) { row.hidden = false; return; }
        const labelEl = row.querySelector('.shortcut-label');
        const descEl  = row.querySelector('.shortcut-desc');
        const a       = row.querySelector('a.shortcut-item');
        const haystack = [
            (labelEl && labelEl.textContent) || '',
            (descEl  && descEl.textContent)  || '',
            (a       && a.href)              || ''
        ].join(' ').toLowerCase();
        row.hidden = !haystack.includes(query);
    });
}

/** Handle change events for selects that need a re-render (sort order, engine). */
function handleGridChange(e) {
    const target = e.target;

    // Search: inline engine selector → persist + re-render.
    if (target.classList && target.classList.contains('engine-select')) {
        const card = target.closest('.widget-card');
        if (!card || !dashboardGrid.contains(card)) return;
        const widget = state.widgets.find(w => w.id === card.dataset.id);
        if (!widget) return;
        widget.config = widget.config || {};
        widget.config.engine = target.value;
        saveFullState();
        Dashboard.renderSearch(widget, card.querySelector('.widget-content'));
        return;
    }

    // Shortcuts: sort-order select → re-render with the chosen order.
    if (!target.classList || !target.classList.contains('shortcut-sort')) return;

    const card = target.closest('.widget-card');
    if (!card || !dashboardGrid.contains(card)) return;
    const widgetId = card.dataset.id;
    const widget = state.widgets.find(w => w.id === widgetId);
    if (!widget) return;
    const contentContainer = card.querySelector('.widget-content');

    // Persist the chosen display order; renderShortcuts handles the actual sorting.
    widget.config = widget.config || {};
    widget.config.sortOrder = target.value; // 'manual' | 'frequent'

    saveFullState();
    Dashboard.renderShortcuts(widget, contentContainer);
}

/**
 * Grid-level delegated keypress handler (Enter key in list or search inputs).
 */

function handleGridKeypress(e) {
    // Inline list editor: Enter saves; Esc cancels.
    if (e.target.classList && (e.target.classList.contains('list-due-input') || e.target.classList.contains('list-note-input'))) {
        const card = e.target.closest('.widget-card');
        if (!card) return;
        const widget = state.widgets.find(w => w.id === card.dataset.id);
        if (!widget) return;
        const contentContainer = card.querySelector('.widget-content');

        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            // Trigger the same save path as clicking Save.
            const li = e.target.closest('.list-item');
            const saveBtn = li && li.querySelector('.list-editor-save');
            if (saveBtn) saveBtn.click();
        } else if (e.key === 'Escape') {
            e.preventDefault();
            const li = e.target.closest('.list-item');
            const cancelBtn = li && li.querySelector('.list-editor-cancel');
            if (cancelBtn) cancelBtn.click();
        }
        return;
    }

    if (e.key !== 'Enter') return;

    const isListInput = e.target.classList.contains('list-input');
    const isSearchInput = e.target.classList.contains('search-input');
    if (!isListInput && !isSearchInput) return;

    // The search box is now a <textarea>: plain Enter runs the search,
    // Shift+Enter inserts a newline so users can compose multi-line queries.
    if (isSearchInput && e.shiftKey) return; // let the browser insert the newline

    e.preventDefault();

    const card = e.target.closest('.widget-card');
    if (!card || !dashboardGrid.contains(card)) return;

    const widget = state.widgets.find(w => w.id === card.dataset.id);
    if (!widget) return;

    const contentContainer = card.querySelector('.widget-content');

    if (isListInput) {
        const text = e.target.value.trim();
        if (!text) return;
        widget.data = widget.data || {};
        widget.data.items = widget.data.items || [];
        widget.data.items.push({ text, completed: false });
        saveFullState();
        Dashboard.renderLists(widget, contentContainer);
    } else {
        // Search (Enter in the query box)
        const query = e.target.value.trim();
        if (!query) return;
        runSearch(widget, query);
    }
}

/**
 * Global keyboard shortcuts. "/" focuses the first Search widget input; Alt+P is an
 * unambiguous alternative. Both are suppressed while the user is typing in any field
 * or when a modal is open.
 */
function handleGlobalShortcuts(e) {
    // Don't hijack keys from inputs / textareas / contenteditable.
    const t = e.target;
    const typingInField = t && (
        t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' ||
        t.isContentEditable
    );

    // Alt+P works even while in a field? No — keep it simple: only when not typing.
    if (typingInField) return;

    const modalOpen = !modalContainer.hidden;
    if (modalOpen) return; // don't steal focus from an open dialog

    let shouldFocus = false;
    if ((e.key === '/' && !e.ctrlKey && !e.metaKey && !e.altKey)) {
        shouldFocus = true;
    } else if (e.altKey && (e.key === 'p' || e.key === 'P')) {
        shouldFocus = true;
    }

    if (!shouldFocus) return;

    const inputEl = dashboardGrid.querySelector('.search-input');
    if (!inputEl) return; // no Search widget present

    e.preventDefault();
    inputEl.focus();
    inputEl.select && inputEl.select();
}

/**
 * Run a search: build the URL from the widget's configured engine (Perplexity,
 * Google, Bing, or DuckDuckGo), record it in recent queries (local, capped at 10),
 * and open it. Shared by the Go button, Enter key, and recent-query chips.
 */
function runSearch(widget, query) {
    const config = widget.config || {};
    const engine = ['perplexity', 'google', 'bing', 'ddg'].includes(config.engine) ? config.engine : 'perplexity';

    // Record the query locally (dedupe, cap at 10).
    widget.data = widget.data || {};
    if (!Array.isArray(widget.data.recentQueries)) widget.data.recentQueries = [];
    const rq = widget.data.recentQueries;
    const idx = rq.findIndex(q => q.toLowerCase() === query.toLowerCase());
    if (idx !== -1) rq.splice(idx, 1);
    rq.unshift(query);
    while (rq.length > 10) rq.pop();

    // Open the result in a new tab by default.
    const url = Dashboard.buildSearchUrl(engine, query);
    window.open(url, config.openInNewTab !== false ? '_blank' : '_self', 'noopener,noreferrer');

    saveFullState();
    // Re-render so the recent-queries chips update immediately.
    const card = dashboardGrid.querySelector(`.widget-card[data-id="${widget.id}"]`);
    if (card) {
        const cc = card.querySelector('.widget-content');
        Dashboard.renderSearch(widget, cc);
    }
}

// Publish the public API on the shared namespace.
Dashboard.handleGridClick = handleGridClick;
Dashboard.handleGridInput = handleGridInput;
Dashboard.handleGridChange = handleGridChange;
Dashboard.handleGridKeypress = handleGridKeypress;
Dashboard.handleGlobalShortcuts = handleGlobalShortcuts;
Dashboard.runSearch = runSearch;
