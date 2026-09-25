/**
 * rss — widget renderer + RSS fetch pipeline. One feed per widget.
 * Classic script: top-level functions become globals.
 */

// Pure, exported proxy-strategy builder. Extracted from the render closure so
// its placeholder handling ({url} / {URL}, trailing "?", path prefix) is unit-testable.
// Returns an ordered array of { label, url } attempts. The caller prepends the
// direct feed URL as its first attempt.
function buildProxyStrategies(feedUrl, settings) {
    const enc = encodeURIComponent(feedUrl);
    const strategies = [];

    let userProxy = '';
    if (settings && typeof settings === 'object') {
        userProxy = String(settings.corsProxyUrl || '').trim();
    }

    if (userProxy) {
        const hasPlaceholder = /\{url\}|\{URL\}/i.test(userProxy);
        let proxied;
        if (hasPlaceholder) {
            proxied = userProxy.replace(/\{(url|URL)\}/gi, enc);
        } else if (/\?/.test(userProxy)) {
            proxied = userProxy + 'url=' + enc;
        } else if (/[/?]$/.test(userProxy)) {
            proxied = userProxy.replace(/[?/]$/, '') + '/?' + 'url=' + enc;
        } else {
            proxied = userProxy + '?url=' + enc;
        }
        strategies.push({ label: 'custom', url: proxied });
    }

    // Public fallback proxies — opt-in only (Settings checkbox).
    if (settings && settings.rssAllowPublicProxies) {
        strategies.push(
            { label: 'allorigins',  url: 'https://api.allorigins.win/raw?url=' + enc },
            { label: 'corsproxy.io', url: 'https://corsproxy.io/?url=' + enc },
            { label: 'codetabs',    url: 'https://api.codetabs.com/v1/proxy?quest=' + enc }
        );
    }

    return strategies;
}

function renderRss(widget, container) {
    widget.data = widget.data || {};
    // Migrate legacy multi-feed shape → single url + maxItems (first feed wins).
    if ((!widget.data.url || typeof widget.data.url !== 'string') && Array.isArray(widget.data.feeds)) {
        const first = widget.data.feeds.find(f => f && typeof f.url === 'string' && f.url.trim());
        if (first) {
            widget.data.url = first.url.trim();
            if (Number.isFinite(first.maxItems)) widget.data.maxItems = first.maxItems;
        }
        delete widget.data.feeds;
        if (typeof Dashboard.saveFullState === 'function') Dashboard.saveFullState();
    }

    const bodyEl = document.createElement('div');
    bodyEl.className = 'rss-body';
    bodyEl.setAttribute('aria-live', 'polite');
    container.appendChild(bodyEl);

    const ATTEMPT_TIMEOUT_MS = 5000;

    async function fetchWithTimeout(targetUrl, ms) {
        return Dashboard.fetchWithTimeout(targetUrl, ms || ATTEMPT_TIMEOUT_MS, { mode: 'cors' });
    }

    // Returns { ok, items } on success or throws an Error whose message names
    // the failing strategy so the card can tell the user which path to debug.
    async function fetchFeed(url, maxItems) {
        const settings = (Dashboard.state && Dashboard.state.settings) || {};
        const attempts = [{ label: 'direct', url }, ...buildProxyStrategies(url, settings)];
        let lastErr = null;
        for (const attempt of attempts) {
            try {
                const res = await fetchWithTimeout(attempt.url, ATTEMPT_TIMEOUT_MS);
                if (!res.ok) throw new Error('HTTP ' + res.status);
                const text = await res.text();

                const doc = new DOMParser().parseFromString(text, 'text/xml');
                let items = [];

                if (doc.querySelector('channel')) {
                    items = Array.from(doc.querySelectorAll('item')).map(it => ({
                        title: it.querySelector('title')?.textContent || '(untitled)',
                        link: it.querySelector('link')?.textContent || ''
                    }));
                } else if (doc.documentElement && doc.documentElement.tagName.toLowerCase() === 'feed') {
                    items = Array.from(doc.querySelectorAll('entry')).map(en => ({
                        title: en.querySelector('title')?.textContent || '(untitled)',
                        link: (en.querySelector("link[rel='alternate']") || en.querySelector('link'))?.getAttribute('href') || ''
                    }));
                }

                items = items.filter(i => i.title).slice(0, maxItems);
                if (items.length) return { ok: true, items };
                lastErr = new Error('No readable items found');
            } catch (e) {
                lastErr = new Error((e && e.message ? e.message : 'fetch failed') + ' [via: ' + attempt.label + ']');
            }
        }
        throw lastErr || new Error('Failed to fetch feed');
    }

    function renderBody(state2) {
        bodyEl.innerHTML = '';
        if (state2.loading) {
            bodyEl.insertAdjacentHTML('beforeend', '<p class="rss-status">Loading…</p>');
        } else if (state2.error) {
            bodyEl.insertAdjacentHTML('beforeend', `<p class="rss-error">⚠️ ${escapeHtml(state2.error)}</p>`);
        } else if (!state2.items || state2.items.length === 0) {
            bodyEl.insertAdjacentHTML('beforeend', '<p class="rss-empty">No items.</p>');
        } else {
            const ul = document.createElement('ul');
            ul.className = 'rss-items';
            state2.items.forEach(item => {
                const li = document.createElement('li');
                const linkOk = item.link && Dashboard.Storage.isValidHttpUrl(item.link);
                if (linkOk) {
                    const a = document.createElement('a');
                    a.href = item.link;
                    a.target = '_blank';
                    a.rel = 'noopener noreferrer';
                    a.textContent = item.title;
                    li.appendChild(a);
                } else {
                    li.textContent = item.title;
                }
                ul.appendChild(li);
            });
            bodyEl.appendChild(ul);
        }
    }

    function formatFetchError(e) {
        const base = e && e.message ? e.message : 'Failed to load';
        const viaMatch = base.match(/\[via:\s*([^\]]+)\]\s*$/);
        const via = viaMatch ? viaMatch[1].trim() : '';
        const cleanBase = base.replace(/\s*\[via:\s*[^\]]+\]\s*$/, '');
        if (/No readable items found/i.test(cleanBase)) {
            return 'Feed loaded but no readable items were parsed (it may not be RSS/Atom).';
        }
        if (/abort|timeout/i.test(cleanBase) || /fetch failed|networkerror|failed to fetch/i.test(cleanBase)) {
            return 'Could not reach the feed via "' + (via || 'direct') + '". This is usually a browser CORS block on the feed’s host. Set a working “CORS Proxy URL” in Settings (or run this dashboard through your own server) and refresh.';
        }
        if (/HTTP \d{3}/i.test(cleanBase)) {
            return cleanBase + ' (via "' + (via || 'direct') + '").';
        }
        return cleanBase + (via ? ' (via "' + via + '").' : '.');
    }

    async function loadFeed() {
        const url = typeof widget.data.url === 'string' ? widget.data.url.trim() : '';
        if (!url) {
            bodyEl.innerHTML = `<p class="rss-empty">${escapeHtml(emptyStateText(widget))}</p>`;
            return;
        }

        let maxItems = Number.isFinite(widget.data.maxItems) ? widget.data.maxItems : 8;
        maxItems = Math.min(50, Math.max(1, maxItems | 0));

        renderBody({ loading: true, items: [], error: '' });
        try {
            const result = await fetchFeed(url, maxItems);
            renderBody({ loading: false, items: result.items, error: '' });
        } catch (e) {
            renderBody({ loading: false, items: [], error: formatFetchError(e) });
        }
    }

    const actions = document.createElement('div');
    actions.className = 'rss-actions';
    actions.innerHTML = '<button type="button" class="rss-refresh-btn">↻ Refresh</button>';
    container.appendChild(actions);

    loadFeed();
    widget.__rssRefresh = () => { renderBody({ loading: true, items: [], error: '' }); loadFeed(); };
}

Dashboard.renderRss = renderRss;
Dashboard.buildProxyStrategies = buildProxyStrategies;

if (typeof module !== 'undefined' && typeof module.exports !== 'undefined') {
    module.exports = globalThis.Dashboard;
}
