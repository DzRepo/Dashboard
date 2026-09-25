/**
 * search — widget renderer. Part of the widgets/ split (P2-10).
 * Classic script: top-level functions become globals.
 */


function renderPerplexity(widget, container) {
    // Clear any previous render so re-renders (e.g. switching provider) never stack a second form.
    if (!container) return;
    container.innerHTML = '';

    const config = widget.config || {};
    // Normalize data so recent-queries can be safely read even on legacy widgets.
    if (!widget.data || typeof widget.data !== 'object') widget.data = {};
    if (!Array.isArray(widget.data.recentQueries)) widget.data.recentQueries = [];

    const engines = [
        { id: 'perplexity', label: 'Perplexity' },
        { id: 'google',     label: 'Google' },
        { id: 'bing',       label: 'Bing' },
        { id: 'ddg',        label: 'DuckDuckGo' }
    ];
    const currentEngine = config.engine || 'perplexity';
    const engineOptions = engines.map(e =>
        `<option value="${e.id}" ${currentEngine === e.id ? 'selected' : ''}>${escapeHtml(e.label)}</option>`
    ).join('');

    // Multi-line search block: provider on its own row, then a taller textarea
    // for the query so longer searches have more room to breathe.
    // C3: class renamed from .perplexity-* to .search-* to match the new type id.
    const searchArea = document.createElement('div');
    searchArea.className = 'search-widget';
    searchArea.innerHTML = `
        <label class="search-provider-row">
            <span>Provider</span>
            <select class="engine-select" aria-label="Choose search engine">${engineOptions}</select>
        </label>
        <div class="search-query-row">
            <textarea
                type="text"
                rows="3"
                placeholder="Search…  (Enter = go, Shift+Enter = newline, press / to focus)"
                class="search-input"
                aria-label="Search query"></textarea>
            <button class="search-btn" type="submit">Go</button>
        </div>
    `;

    // Recent queries (local, capped at 10) shown as clickable chips.
    const recent = widget.data.recentQueries || [];
    if (recent.length > 0) {
        const recentWrap = document.createElement('div');
        // C3: class renamed from .perplexity-* to .search-*.
        recentWrap.className = 'search-recent';
        recentWrap.innerHTML = '<span class="search-recent-label">Recent:</span> ' +
            recent.slice(0, 5).map(q => `<button type="button" class="recent-chip" data-q="${escapeAttr(q)}">${escapeHtml(truncate(q, 28))}</button>`).join('');
        searchArea.appendChild(recentWrap);
    }

    container.appendChild(searchArea);
    // Note: click / keydown handlers are delegated at the dashboardGrid level
    // (see handleGridClick / handleGridKeypress in app.js) so re-renders never
    // stack duplicate listeners.
}

/**
 * T7 — Currency Converter Widget (multi-currency rate board)
 *
 * Data shape:
 *   config: { from: 'USD', toCodes: ['EUR','GBP','JPY'] }   // base + chosen targets
 *   data:   { rates: { EUR: 0.92, … }, updatedAt: null, error: null }
 *
 * Each target currency shows the rate for **$1 (base) → that currency**,
 * and its row links out to XE.com's chart for that pair — same URL scheme as
 * before (`…/currencycharts/?from=USD&to=<CODE>`).
 *
 * Uses frankfurter.dev v1 (ECB reference rates) — keyless, CORS-friendly.
 * Fetches on mount; no timer and no manual refresh button (rates change slowly).
 */

// P2-9: publish on the shared namespace.
Dashboard.renderPerplexity = renderPerplexity;

if (typeof module !== 'undefined' && typeof module.exports !== 'undefined') {
    module.exports = globalThis.Dashboard;
}
