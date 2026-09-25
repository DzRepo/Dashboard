/**
 * habits — widget renderer. Part of the widgets/ split (P2-10).
 * Classic script: top-level functions become globals.
 */


function renderHabits(widget, container) {
    widget.data = widget.data || {};
    if (!Array.isArray(widget.data.habits)) widget.data.habits = [];
    if (typeof widget.data.log !== 'object' || widget.data.log === null) widget.data.log = {};

    // B6: log pruning now happens once at load time in app.js init() via pruneHabitsLog().
    container.innerHTML = '';

    // ── Helpers ────────────────────────────────────────────────
    // B6: _dateKey is a module-level helper (see top of this file).

    // Build the last-7-days array ending today.
    function lastSevenDays() {
        const days = [];
        for (let i = 6; i >= 0; i--) {
            const d = new Date();
            d.setDate(d.getDate() - i);
            days.push({ key: _dateKey(d), label: d.toLocaleDateString(undefined, { weekday: 'short' }) });
        }
        return days;
    }

    function isDone(habitId, dateKey) {
        const arr = widget.data.log[dateKey];
        return Array.isArray(arr) && arr.includes(habitId);
    }

    // ── Render ────────────────────────────────────────────────
    function renderGrid() {
        if (widget.data.habits.length === 0) {
            // C5: shared copy from registry metadata.
            container.innerHTML = `<p class="habit-empty">${escapeHtml(emptyStateText(widget))}</p>`;
            return;
        }

        const days = lastSevenDays();
        const todayKey = _dateKey(new Date());

        // Header row: day labels.
        let html = '<div class="habit-grid" role="table" aria-label="Habit completion grid">';
        html += '<div class="habit-header-row" role="row"><span class="habit-col-name"></span>';
        for (const d of days) {
            const isToday = d.key === todayKey;
            html += `<span class="habit-day-label${isToday ? ' habit-today' : ''}" role="columnheader">${escapeHtml(d.label)}</span>`;
        }
        html += '</div>';

        // One row per habit.
        for (const h of widget.data.habits) {
            html += `<div class="habit-row" role="row" data-habit-id="${escapeAttr(h.id)}">`;
            html += `<span class="habit-col-name" title="${escapeHtml(h.label)}">${escapeHtml(h.label)}</span>`;
            for (const d of days) {
                const done = isDone(h.id, d.key);
                const clickable = d.key === todayKey; // only today is toggleable
                html += `
                    <button type="button" class="habit-cell${done ? ' habit-done' : ''}${clickable ? ' habit-clickable' : ''}"
                            role="cell"
                            aria-label="${escapeHtml(h.label)} — ${d.label}: ${done ? 'completed' : 'not completed'}"
                            data-habit-id="${escapeAttr(h.id)}" data-date-key="${d.key}"${clickable ? '' : ' disabled'}>
                        ${done ? '✓' : ''}
                    </button>`;
            }
            html += '</div>';
        }
        html += '</div>';

        container.innerHTML = html;
    }

    renderGrid();

    // ── Toggle handler (delegated on the grid) ────────────────
    function handleToggle(e) {
        const cell = e.target.closest('.habit-cell');
        if (!cell || !cell.classList.contains('habit-clickable')) return;

        const habitId  = cell.dataset.habitId;
        const dateKey  = cell.dataset.dateKey;

        // Toggle: add or remove from today's log.
        if (isDone(habitId, dateKey)) {
            widget.data.log[dateKey] = (widget.data.log[dateKey] || []).filter(id => id !== habitId);
        } else {
            if (!Array.isArray(widget.data.log[dateKey])) widget.data.log[dateKey] = [];
            widget.data.log[dateKey].push(habitId);
        }

        // Persist + re-render just this card.
        Dashboard.saveFullState();
        renderGrid();
    }

    container.addEventListener('click', handleToggle);
}

// P2-9: publish on the shared namespace.
Dashboard.renderHabits = renderHabits;

if (typeof module !== 'undefined' && typeof module.exports !== 'undefined') {
    module.exports = globalThis.Dashboard;
}
