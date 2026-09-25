/**
 * notes — widget renderer. Part of the widgets/ split (P2-10).
 * Classic script: top-level functions become globals.
 */


function renderNotes(widget, container) {
    widget.data = widget.data || {};
    const ta = document.createElement('textarea');
    ta.className = 'notes-textarea';
    ta.placeholder = 'Jot something down… (autosaves as you type)';
    ta.value = widget.data.text || '';

    // P3-10: debounce with a local setTimeout; flush via widget.__notesFlush
    // (called from renderDashboard before the grid is wiped, and from createWidgetElement).
    // clearWidgetTimer only clears intervals — it does not participate in notes saves.
    let saveTimer = null;
    function scheduleSave() {
        if (saveTimer) clearTimeout(saveTimer);
        saveTimer = setTimeout(() => {
            widget.data.text = ta.value;
            widget.data.updatedAt = Date.now();
            Dashboard.saveFullState();
            updateTimestamp();
        }, 300);
    }

    // Flush any pending debounced save when the widget is about to be re-rendered.
    widget.__notesFlush = () => {
        if (saveTimer) {
            clearTimeout(saveTimer);
            saveTimer = null;
            widget.data.text = ta.value;
            widget.data.updatedAt = Date.now();
            Dashboard.saveFullState();
        }
    };

    function updateTimestamp() {
        const tsEl = container.querySelector('.notes-timestamp');
        if (!tsEl) return;
        if (widget.data.updatedAt) {
            tsEl.textContent = 'Saved ' + new Date(widget.data.updatedAt).toLocaleString();
        } else {
            tsEl.textContent = '';
        }
    }

    const ts = document.createElement('div');
    ts.className = 'notes-timestamp';
    updateTimestamp();

    ta.addEventListener('input', scheduleSave);
    ta.addEventListener('blur', () => {
        if (saveTimer) { clearTimeout(saveTimer); saveTimer = null; }
        widget.data.text = ta.value;
        widget.data.updatedAt = Date.now();
        Dashboard.saveFullState();
        updateTimestamp();
    });

    container.appendChild(ta);
    container.appendChild(ts);
}

/**
 * Stock Watchlist Widget
 *
 * Data: { symbols: [{ symbol, name, lastPrice }] }
 *
 * Quotes come from the Twelve Data API using the key stored in Settings; each
 * ticker is queried individually (the free tier allows one quote call per request).
 *
 * Pricing data is cached locally on widget.data and served from there instead of
 * hitting the API every time. A fetch only happens when the cache is older than
 * 15 minutes or when the user clicks "Refresh quotes" manually.
 *
 * If no key is set, a call fails, or the network is down, cached prices are shown
 * and a hint points to Settings → Stocks & APIs. Errors never break the render.
 */

// P2-9: publish on the shared namespace.
Dashboard.renderNotes = renderNotes;

if (typeof module !== 'undefined' && typeof module.exports !== 'undefined') {
    module.exports = globalThis.Dashboard;
}
