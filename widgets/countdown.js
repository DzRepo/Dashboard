/**
 * countdown — widget renderer. One renderer per widget type.
 * Classic script: top-level functions become globals.
 */


function renderCountdown(widget, container) {
    widget.data = widget.data || {};
    if (!Array.isArray(widget.data.events)) widget.data.events = [];

    container.innerHTML = '';

    const listEl = document.createElement('div');
    listEl.className = 'countdown-list';
    container.appendChild(listEl);

    function fmtRemaining(ms) {
        if (ms < 0) ms = 0;
        const totalSec = Math.floor(ms / 1000);
        const d = Math.floor(totalSec / 86400);
        const h = Math.floor((totalSec % 86400) / 3600);
        const m = Math.floor((totalSec % 3600) / 60);
        const s = totalSec % 60;
        if (d > 0) return `${d}d ${h}h ${m}m`;
        if (h > 0) return `${h}h ${m}m ${s}s`;
        if (m > 0) return `${m}m ${s}s`;
        return `${s}s`;
    }

    function renderList() {
        listEl.innerHTML = '';
        const events = widget.data.events.slice().sort((a, b) => new Date(a.when) - new Date(b.when));
        if (events.length === 0) {
            listEl.innerHTML = `<p class="countdown-empty">${escapeHtml(emptyStateText(widget))}</p>`;
            return;
        }
        const now = Date.now();
        events.forEach(ev => {
            const whenMs = new Date(ev.when).getTime();
            if (isNaN(whenMs)) return;
            const diff = whenMs - now;
            const past = diff < 0;

            const row = document.createElement('div');
            row.className = 'countdown-row' + (past ? ' past': '');

            const labelEl = document.createElement('span');
            labelEl.className = 'countdown-label';
            labelEl.textContent = ev.label || new Date(whenMs).toLocaleDateString();

            const valueEl = document.createElement('span');
            // Right-justified so the d/h/m/s blocks line up at the right edge;
            // white text instead of the accent blue (see.countdown-value.future).
            valueEl.className = 'countdown-value' + (past ? '': ' future');
            if (past) {
                // Parentheses so the ternary binds to `diff < 60000`, not the string concat.
                valueEl.textContent = (Math.abs(diff) > 60000)
                    ? fmtRemaining(Math.abs(diff)) + ' ago'
: 'Just now';
            } else {
                valueEl.textContent = fmtRemaining(diff);
            }

            const dateEl = document.createElement('small');
            dateEl.className = 'countdown-date';
            dateEl.textContent = new Date(whenMs).toLocaleString();

            row.appendChild(labelEl);
            row.appendChild(valueEl);
            row.appendChild(dateEl);
            listEl.appendChild(row);
        });
    }

    function tick() { renderList(); }

    // clear any previous interval for this widget so re-renders don't stack timers.
    clearWidgetTimer(widget.id);
    tick();
    setWidgetTimer(widget.id, setInterval(tick, 1000));
}

/** thin alias over the shared registry — kept so existing call-sites read naturally. */
function clearCountdownTimer(widgetId) { return clearWidgetTimer(widgetId); }


// Publish on the shared Dashboard namespace.
Dashboard.renderCountdown = renderCountdown;
Dashboard.clearCountdownTimer = clearCountdownTimer;

if (typeof module !== 'undefined' && typeof module.exports !== 'undefined') {
    module.exports = globalThis.Dashboard;
}
