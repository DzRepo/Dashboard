/**
 * rss — widget renderer. Part of the widgets/ split (P2-10).
 * Classic script: top-level functions become globals.
 */


function renderRss(widget, container) {
    widget.data = widget.data || {};
    if (!Array.isArray(widget.data.feeds)) widget.data.feeds = [];

    const bodyEl = document.createElement('div');
    bodyEl.className = 'rss-body';
    bodyEl.setAttribute('aria-live', 'polite');
    container.appendChild(bodyEl);

    function parseDate(str) {
        if (!str) return null;
        const d = new Date(str);
        return isNaN(d.getTime()) ? null : d;
    }

    // Build the ordered list of proxy strategies to try. A user-configured
    // CORS proxy (Settings → "CORS Proxy URL") is honored first so a working
    // endpoint always wins; then we rotate through public proxies as fallbacks.
    function buildProxyStrategies(feedUrl) {
        const enc = encodeURIComponent(feedUrl);
        const strategies = [];

        // 1. User-configured proxy (highest priority). Supports the two common
        //    placeholder conventions: {url} / {URL}, or a trailing "?" for append.
        let userProxy = '';
        try {
            const _st = Dashboard.state;
            if (_st && _st.settings) {
                userProxy = String(_st.settings.corsProxyUrl || '').trim();
            }
        } catch (_) { /* ignore */ }

        if (userProxy) {
            const hasPlaceholder = /\{url\}|\{URL\}/i.test(userProxy);
            let proxied;
            if (hasPlaceholder) {
                proxied = userProxy.replace(/\{(url|URL)\}/gi, enc);
            } else if (/\?/.test(userProxy)) {
                // Already has a query string — append url=…
                proxied = userProxy + 'url=' + enc;
            } else if (/[/?]$/.test(userProxy)) {
                // Trailing slash or ? → treat as path prefix
                proxied = userProxy.replace(/[?/]$/, '') + '/?' + 'url=' + enc;
            } else {
                proxied = userProxy + '?url=' + enc;
            }
            strategies.push({ label: 'custom', url: proxied });
        }

        // 2. Public fallback proxies (best-effort; many are flaky/broken, but a
        //    few may work depending on network/region/time).
        const publicProxies = [
            { label: 'allorigins', url: 'https://api.allorigins.win/raw?url=' + enc },
            { label: 'corsproxy.io', url: 'https://corsproxy.io/?url=' + enc },
            { label: 'codetabs', url: 'https://api.codetabs.com/v1/proxy?quest=' + enc }
        ];
        strategies.push(...publicProxies);

        return strategies;
    }

    // Fetch a single URL with an AbortController timeout. Returns the response.
    async function fetchWithTimeout(targetUrl, ms) {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), ms || 9000);
        try {
            return await fetch(targetUrl, { mode: 'cors', signal: controller.signal });
        } finally {
            clearTimeout(timer);
        }
    }

    async function fetchFeed(url, maxItems) {
        // Try the feed directly first; then rotate through proxy strategies.
        const attempts = [{ label: 'direct', url }, ...buildProxyStrategies(url)];
        let lastErr = null;
        for (const attempt of attempts) {
            try {
                const res = await fetchWithTimeout(attempt.url, 9000);
                if (!res.ok) throw new Error('HTTP ' + res.status);
                const text = await res.text();

                // Minimal RSS/Atom parser (no external deps).
                const doc = new DOMParser().parseFromString(text, 'text/xml');
                let items = [];

                if (doc.querySelector('channel')) {
                    // RSS 2.0 / RDF: <item>
                    items = Array.from(doc.querySelectorAll('item')).map(it => ({
                        title: it.querySelector('title')?.textContent || '(untitled)',
                        link: it.querySelector('link')?.textContent || '',
                        date: parseDate(it.querySelector('pubDate')?.textContent) || null
                    }));
                } else if (doc.documentElement && doc.documentElement.tagName.toLowerCase() === 'feed') {
                    // Atom: <entry>
                    items = Array.from(doc.querySelectorAll('entry')).map(en => ({
                        title: en.querySelector('title')?.textContent || '(untitled)',
                        link: (en.querySelector("link[rel='alternate']") || en.querySelector('link'))?.getAttribute('href') || '',
                        date: parseDate(
                            en.querySelector('updated')?.textContent ||
                            en.querySelector('published')?.textContent
                        ) || null
                    }));
                }

                items = items.filter(i => i.title).slice(0, maxItems);
                if (items.length) return { ok: true, items };
                lastErr = new Error('No readable items found');
            } catch (e) {
                lastErr = e;
            }
        }
        throw lastErr || new Error('Failed to fetch feed');
    }

    function renderFeedBlock(feed, state2) {
        const block = document.createElement('div');
        block.className = 'rss-feed';
        const labelEl = document.createElement('h4');
        labelEl.className = 'rss-feed-label';
        labelEl.textContent = feed.label || new URL(feed.url).hostname;
        block.appendChild(labelEl);

        if (state2.loading) {
            block.insertAdjacentHTML('beforeend', '<p class="rss-status">Loading…</p>');
        } else if (state2.error) {
            block.insertAdjacentHTML('beforeend', `<p class="rss-error">⚠️ ${escapeHtml(state2.error)}</p>`);
        } else if (!state2.items || state2.items.length === 0) {
            block.insertAdjacentHTML('beforeend', '<p class="rss-empty">No items.</p>');
        } else {
            const ul = document.createElement('ul');
            ul.className = 'rss-items';
            state2.items.forEach(item => {
                const li = document.createElement('li');
                if (item.link) {
                    const a = document.createElement('a');
                    a.href = item.link;
                    a.target = '_blank';
                    a.rel = 'noopener noreferrer';
                    a.textContent = item.title;
                    li.appendChild(a);
                } else {
                    li.textContent = item.title;
                }
                if (item.date) {
                    const d = document.createElement('small');
                    d.className = 'rss-item-date';
                    d.textContent = item.date.toLocaleDateString();
                    li.appendChild(d);
                }
                ul.appendChild(li);
            });
            block.appendChild(ul);
        }

        return block;
    }

    async function loadAll() {
        const feeds = widget.data.feeds;
        if (feeds.length === 0) {
            // C5: shared copy from registry metadata.
            bodyEl.innerHTML = `<p class="rss-empty">${escapeHtml(emptyStateText(widget))}</p>`;
            return;
        }
        // Reset state.
        const states = {};
        feeds.forEach(f => { states[f.url] = { loading: true, items: [], error: '' }; });
        bodyEl.innerHTML = '';
        feeds.forEach(f => bodyEl.appendChild(renderFeedBlock(f, states[f.url])));

        await Promise.all(feeds.map(async (f) => {
            try {
                const result = await fetchFeed(f.url, f.maxItems || 8);
                states[f.url] = { loading: false, items: result.items, error: '' };
            } catch (e) {
                // Build a clear, actionable message. Most failures here are
                // browser CORS blocks on the feed host — explain that and point
                // to the optional proxy setting rather than showing a raw error.
                const base = e && e.message ? e.message : 'Failed to load';
                let msg;
                if (/No readable items found/i.test(base)) {
                    msg = 'Feed loaded but no readable items were parsed (it may not be RSS/Atom).';
                } else if (/abort|timeout/i.test(base) || /fetch failed|networkerror|failed to fetch/i.test(base)) {
                    msg = 'Could not reach the feed. This is usually a browser CORS block on the feed’s host — public proxies are currently unreliable. Set a working “CORS Proxy URL” in Settings (or run this dashboard through your own server) and refresh.';
                } else if (/HTTP \d{3}/i.test(base)) {
                    msg = base + ' from one of the fetch attempts (direct feed or proxy).';
                } else {
                    msg = base + '. If it’s a CORS/network block, set a working “CORS Proxy URL” in Settings and refresh.';
                }
                states[f.url] = { loading: false, items: [], error: msg };
            }
        }));

        bodyEl.innerHTML = '';
        feeds.forEach(f => bodyEl.appendChild(renderFeedBlock(f, states[f.url])));
    }

    const actions = document.createElement('div');
    actions.className = 'rss-actions';
    actions.innerHTML = '<button type="button" class="rss-refresh-btn">↻ Refresh</button>';
    container.appendChild(actions);

    loadAll();
    actions.querySelector('.rss-refresh-btn').addEventListener('click', () => { bodyEl.innerHTML = '<p class="rss-status">Loading…</p>'; loadAll(); });
}

/**
 * T7 — Pomodoro / Focus Timer Widget
 *
 * Data shape:
 *   config: { focusMin: 25, shortBreakMin: 5, longBreakMin: 15, sessionsUntilLong: 4 }
 *   data:   { running: false, mode: 'focus'|'short'|'long', remainingSec: <number>,
 *             completedSessions: <number> }
 *
 * C2: timer bookkeeping uses the shared widgetTimers registry (see top of this file).
 */

// P2-9: publish on the shared namespace.
Dashboard.renderRss = renderRss;

if (typeof module !== 'undefined' && typeof module.exports !== 'undefined') {
    module.exports = globalThis.Dashboard;
}
