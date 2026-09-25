/**
 * search — widget renderer. Part of the widgets/ split (P2-10).
 * Classic script: top-level functions become globals.
 */

function renderSearch(widget, container) {
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
    const searchArea = document.createElement('div');
    searchArea.className = 'search-widget';
    searchArea.innerHTML = `
        <label class="search-provider-row">
            <span>Provider</span>
            <select class="engine-select" aria-label="Choose search engine">${engineOptions}</select>
        </label>
        <div class="search-query-row">
            <textarea
                rows="3"
                placeholder="Search…  (Enter = go, Shift+Enter = newline, press / to focus)"
                class="search-input"
                aria-label="Search query"></textarea>
            <button class="search-btn" type="submit">Go</button>
        </div>
    `;

    // Recent queries (stored capped at 10; show up to 5) as clickable chips.
    const recent = widget.data.recentQueries || [];
    if (recent.length > 0) {
        const recentWrap = document.createElement('div');
        recentWrap.className = 'search-recent';
        recentWrap.innerHTML = '<span class="search-recent-label">Recent:</span> ' +
            recent.slice(0, 5).map(q => `<button type="button" class="recent-chip" data-q="${escapeAttr(q)}">${escapeHtml(truncate(q, 28))}</button>`).join('');
        searchArea.appendChild(recentWrap);
    }

    container.appendChild(searchArea);
    // Click / keydown handlers are delegated at the dashboardGrid level
    // (see handleGridClick / handleGridKeypress in app/grid.js).
}

// P2-9: publish on the shared namespace (legacy alias kept for older call sites).
Dashboard.renderSearch = renderSearch;
Dashboard.renderPerplexity = renderSearch;

if (typeof module !== 'undefined' && typeof module.exports !== 'undefined') {
    module.exports = globalThis.Dashboard;
}
