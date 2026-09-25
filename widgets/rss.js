/**
 * rss — widget renderer + RSS fetch pipeline. One renderer per widget type.
 * Classic script: top-level functions become globals.
 * 7 (2026-09): the fetch pipeline was reworked so a feed fails fast (~5 s per
 * attempt, no 45 s worst case) and third-party public proxies are opt-in behind a
 * Settings checkbox (default off). The per-feed error names which strategy failed.
 */

// pure, exported proxy-strategy builder. Extracted from the render closure so
// its placeholder handling ({url} / {URL}, trailing "?", path prefix) is unit-testable.
// Returns an ordered array of { label, url } attempts. The caller prepends the
// direct feed URL as its first attempt.
// settings.corsProxyUrl — user's own proxy endpoint ("{url}" placeholder or
// trailing "?"/path-prefix conventions supported).
// settings.rssAllowPublicProxies — opt-in flag; when true, well-known public
// proxies are appended after the user proxy.
function buildProxyStrategies(feedUrl, settings) {
    const enc = encodeURIComponent(feedUrl);
    const strategies = [];

    // 1. User-configured proxy (highest priority). Supports the two common
    // placeholder conventions: {url} / {URL}, or a trailing "?" for append.
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

    // 2. Public fallback proxies — OPT-IN. Default off: routing a user's feed
    // URL through strangers' public proxies is flaky and a mild privacy smell. The
    // README's own recommendation is "run your own worker"; the user proxy above is
    // the first-party path. Only when the user explicitly opts in do we fall back.
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
    if (!Array.isArray(widget.data.feeds)) widget.data.feeds = [];

    const bodyEl = document.createElement('div');
    bodyEl.className = 'rss-body';
    bodyEl.setAttribute('aria-live', 'polite');
    container.appendChild(bodyEl);

    function parseDate(str) {
        if (!str) return null;
        const d = new Date(str);
        return isNaN(d.getTime()) ? null: d;
    }

    // per-attempt timeout cut from 9 s to 5 s so a fully blocked feed fails
    // in ~10–15 s (direct + user proxy) instead of the old 45+ s worst case.
    const ATTEMPT_TIMEOUT_MS = 5000;

    // Fetch a single URL with an AbortController timeout. Returns the response.
    async function fetchWithTimeout(targetUrl, ms) {
        return Dashboard.fetchWithTimeout(targetUrl, ms || ATTEMPT_TIMEOUT_MS, { mode: 'cors' });
    }

    // returns { ok, items } on success or throws an Error whose message names
    // the failing strategy (e.g. "direct", "custom proxy") so the card can tell the
    // user which path to debug.
    async function fetchFeed(url, maxItems) {
        const settings = (Dashboard.state && Dashboard.state.settings) || {};
        // Try the feed directly first; then rotate through proxy strategies.
        const attempts = [{ label: 'direct', url },...buildProxyStrategies(url, settings)];
        let lastErr = null;
        for (const attempt of attempts) {
            try {
                const res = await fetchWithTimeout(attempt.url, ATTEMPT_TIMEOUT_MS);
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
                // Tag the error with which strategy failed so the card can name it.
                lastErr = new Error((e && e.message ? e.message: 'fetch failed') + ' [via: ' + attempt.label + ']');
            }
        }
        throw lastErr || new Error('Failed to fetch feed');
    }

    function renderFeedBlock(feed, state2) {
        const block = document.createElement('div');
        block.className = 'rss-feed';
        const labelEl = document.createElement('h4');
        labelEl.className = 'rss-feed-label';
        let feedLabel = feed.label || '';
        if (!feedLabel) {
            try { feedLabel = new URL(feed.url).hostname; }
            catch (_) { feedLabel = String(feed.url || 'Feed'); }
        }
        labelEl.textContent = feedLabel;
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
                // build a clear, actionable message and name the failing
                // strategy (the [via: …] tag that fetchFeed appends) so the user can
                // debug their proxy from the card. Most failures are browser CORS
                // blocks on the feed host — point to the optional proxy setting.
                const base = e && e.message ? e.message: 'Failed to load';
                // Extract the strategy label from the [via: …] tag, if present.
                const viaMatch = base.match(/\[via:\s*([^\]]+)\]\s*$/);
                const via = viaMatch ? viaMatch[1].trim(): '';
                // Strip the tag from the base message for cleaner display.
                const cleanBase = base.replace(/\s*\[via:\s*[^\]]+\]\s*$/, '');
                let msg;
                if (/No readable items found/i.test(cleanBase)) {
                    msg = 'Feed loaded but no readable items were parsed (it may not be RSS/Atom).';
                } else if (/abort|timeout/i.test(cleanBase) || /fetch failed|networkerror|failed to fetch/i.test(cleanBase)) {
                    msg = 'Could not reach the feed via "' + (via || 'direct') + '". This is usually a browser CORS block on the feed’s host. Set a working “CORS Proxy URL” in Settings (or run this dashboard through your own server) and refresh.';
                } else if (/HTTP \d{3}/i.test(cleanBase)) {
                    msg = cleanBase + ' (via "' + (via || 'direct') + '").';
                } else {
                    msg = cleanBase + (via ? ' (via "' + via + '").': '.');
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
    // Expose refresh for header ↻ and grid-delegated.rss-refresh-btn clicks.
    widget.__rssRefresh = () => { bodyEl.innerHTML = '<p class="rss-status">Loading…</p>'; loadAll(); };
}


// Publish on the shared Dashboard namespace.
Dashboard.renderRss = renderRss;
// publish the pure proxy-strategy builder so Node tests can unit-test it.
Dashboard.buildProxyStrategies = buildProxyStrategies;

if (typeof module !== 'undefined' && typeof module.exports !== 'undefined') {
    module.exports = globalThis.Dashboard;
}
