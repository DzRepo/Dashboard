/**
 * stocks — widget renderer. Part of the widgets/ split (P2-10).
 * Classic script: top-level functions become globals.
 */


function getTwelveDataKey() {
    try { const s = Dashboard.state; return ((s && s.settings) || {}).twelvedataApiKey || ''; } catch (e) { return ''; }
}

/**
 * T5 — Build a small inline SVG sparkline from an array of numeric values.
 * Returns '' if fewer than 2 valid points. The path is colored by direction:
 * green when last >= first, red otherwise.
 */
function buildSparkline(values, width, height) {
    const pts = (values || []).filter(v => Number.isFinite(Number(v)));
    if (pts.length < 2) return '';

    // Normalize to [0..1] range within the SVG box.
    let min = Infinity, max = -Infinity;
    for (const v of pts) { const n = Number(v); if (n < min) min = n; if (n > max) max = n; }
    const span = (max - min) || 1;

    // Leave a small padding so the line doesn't touch the edges.
    const padX = 2, padY = 3;
    const innerW = width - padX * 2;
    const innerH = height - padY * 2;

    const coords = pts.map((v, i) => {
        const x = padX + (i / (pts.length - 1)) * innerW;
        const y = padY + (1 - ((Number(v) - min) / span)) * innerH;
        return `${x.toFixed(1)},${y.toFixed(1)}`;
    });

    // Color: green if trending up, red otherwise.
    const first = Number(pts[0]);
    const last  = Number(pts[pts.length - 1]);
    // Track the semantic success/danger tokens so sparklines match theme + other widgets.
    const color = (last >= first) ? 'var(--color-success, #3fb950)' : 'var(--color-danger, #f87171)';

    return `<svg class="stock-sparkline" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" aria-hidden="true">` +
           `<polyline points="${coords.join(' ')}" fill="none" stroke="${color}" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>` +
           `</svg>`;
}

function renderStocks(widget, container) {
    widget.data = widget.data || {};
    widget.data.symbols = widget.data.symbols || [];

    const listEl = document.createElement('div');
    listEl.className = 'stocks-list';
    // Announce price updates to screen readers without stealing focus.
    listEl.setAttribute('aria-live', 'polite');
    listEl.setAttribute('role', 'region');
    listEl.setAttribute('aria-label', 'Stock prices');

    const statusEl = document.createElement('div');
    statusEl.className = 'stock-status';

    container.appendChild(listEl);
    container.appendChild(statusEl);

    function renderList() {
        listEl.innerHTML = '';
        if (widget.data.symbols.length === 0) {
            listEl.innerHTML = `<p class="stock-empty">${escapeHtml(emptyStateText(widget))}</p>`;
            return;
        }
        widget.data.symbols.forEach((s, i) => {
            const row = document.createElement('div');
            row.className = 'stock-row';
            const price = s.lastPrice != null ? `$${Number(s.lastPrice).toFixed(2)}` : '--';
            // Split the change into its two parts so they can be stacked under the
            // price (right-justified, smaller text).
            let changeText = '';
            let pctText = '';
            if (typeof s.change === 'number') {
                const dir = s.change >= 0 ? '+' : '';
                changeText = `${dir}${s.change.toFixed(2)}`;
                pctText = `(${((s.changePct || 0)).toFixed(2)}%)`;
            }
            // Ticker symbol is intentionally hidden — show only name + price info.
            const spark = s.sparkline ? buildSparkline(s.sparkline, 64, 28) : '';

            // T14: Make the stock name a clickable link to a configurable URL template.
            // Default: https://www.google.com/finance/beta/quote/{ticker}
            const displayName = s.name || s.symbol;
            let nameHtml;
            const _st = Dashboard.state;
            if (_st && _st.settings && typeof _st.settings.stockLinkTemplate === 'string' && _st.settings.stockLinkTemplate.includes('{ticker}')) {
                const url = _st.settings.stockLinkTemplate.replace('{ticker}', encodeURIComponent(s.symbol));
                nameHtml = `<a class="stock-name stock-link" href="${escapeAttr(url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(displayName)}</a>`;
            } else {
                // Fallback default template
                const url = 'https://www.google.com/finance/beta/quote/' + encodeURIComponent(s.symbol);
                nameHtml = `<a class="stock-name stock-link" href="${escapeAttr(url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(displayName)}</a>`;
            }

            row.innerHTML = `
                ${nameHtml}
                ${spark}
                <div class="stock-value" data-index="${i}">
                    <span class="stock-price">${price}</span>${changeText ? `<small class="stock-change ${s.change >= 0 ? 'up' : 'down'}">${escapeHtml(changeText)}&nbsp;${escapeHtml(pctText)}</small>` : ''}
                </div>
            `;
            listEl.appendChild(row);
        });
    }

    function setStatus(html) { statusEl.innerHTML = html || ''; }

    // How stale the cached quotes must be before we hit the API again.
    const STALE_MS = 15 * 60 * 1000; // 15 minutes

    // True when there is no usable cache, or the last successful fetch is older
    // than STALE_MS. A manual refresh bypasses this check entirely.
    function isStale() {
        const ts = widget.data.updatedAt;
        if (typeof ts !== 'number' || !isFinite(ts)) return true; // never fetched → stale
        return (Date.now() - ts) > STALE_MS;
    }

    async function fetchQuotes(force) {
        const symbols = widget.data.symbols.map(s => s.symbol).filter(Boolean);
        if (symbols.length === 0) return;

        // Serve from the local cache when it's fresh — no API call.
        if (!force && !isStale()) {
            renderList();
            const ageMin = Math.max(1, Math.round((Date.now() - widget.data.updatedAt) / 60000));
            setStatus(`<p class="stock-status-cached">Showing cached quotes from ${ageMin} min ago. Auto-refreshes when older than 15 min — or hit ↻ Refresh.</p>`);
            return;
        }

        const key = getTwelveDataKey();
        if (!key) {
            setStatus('<p class="stock-status-key">Add your <strong>Twelve Data API key</strong> in Settings → Stocks &amp; APIs to load live quotes.</p>');
            renderList(); // still show any cached prices
            return;
        }

        // T5 — batched fetch: group symbols into chunks of 4 so we make
        // ceil(N/4) parallel call-groups instead of N fully-sequential ones.
        //
        // P2-7: each symbol costs TWO API calls (quote + time_series). A 4-ticker
        // watchlist auto-refresh issues up to 8 concurrent calls — right at the free
        // tier's ~8 credits/minute. To stay under the limit, we skip time_series on
        // automatic refreshes (sparkline only updates on manual ↻). This halves the
        // credit cost of auto-refresh to N calls instead of 2N.
        const CHUNK = 4;
        let failures = 0;
        let rateLimited = false;

        for (let c = 0; c < symbols.length; c += CHUNK) {
            const chunk = symbols.slice(c, c + CHUNK);
            await Promise.all(chunk.map(async (symbol) => {
                // I2: resolve the target row once per symbol instead of calling
                // widget.data.symbols.find() three times below.
                const target = widget.data.symbols.find(s => s.symbol === symbol);
                if (!target) return;
                try {
                    // --- Quote call -------------------------------------------------
                    const qUrl = 'https://api.twelvedata.com/quote?symbol=' + encodeURIComponent(symbol)
                        + '&apikey=' + encodeURIComponent(key);
                    const res = await fetch(qUrl, { mode: 'cors' });
                    if (!res.ok) throw new Error('HTTP ' + res.status);
                    const json = await res.json();

                    // Twelve Data signals errors via a lowercase status and/or numeric code.
                    const isErr = json && (
                        String(json.status || '').toLowerCase() === 'error' ||
                        (Number.isFinite(Number(json.code)) && Number(json.code) !== 0)
                    );
                    if (isErr) {
                        failures++;
                        // P2-7: detect rate-limit specifically so the status line can
                        // tell the user to wait a minute instead of blaming their key.
                        const errMsg = String(json.message || json.status || '').toLowerCase();
                        if (/rate.?limit|too many requests|exceeded/i.test(errMsg)) {
                            rateLimited = true;
                        }
                        console.warn('twelvedata quote error for ' + symbol, json.message || json.status);
                        return; // keep cached price
                    }

                    const rawPrice = json.close != null ? json.close : json.price;
                    const price = parseFloat(rawPrice);
                    if (Number.isFinite(price)) {
                        target.lastPrice = price;
                        let chg = parseFloat(json.change != null ? json.change : null);
                        let pct = parseFloat(json.percent_change != null ? json.percent_change : null);
                        if (!Number.isFinite(chg)) {
                            const prevClose = parseFloat(json.previous_close || json.close);
                            if (Number.isFinite(prevClose) && prevClose !== 0) chg = price - prevClose;
                        }
                        if (!Number.isFinite(pct)) {
                            const prevClose = parseFloat(json.previous_close != null ? json.previous_close : rawPrice);
                            if (Number.isFinite(prevClose) && prevClose !== 0) pct = ((price - prevClose) / prevClose) * 100;
                        }
                        if (Number.isFinite(chg)) target.change = chg; else delete target.change;
                        if (Number.isFinite(pct)) target.changePct = pct; else delete target.changePct;
                    } else {
                        failures++;
                    }

                    // T14: Only fill in the company name from the API if the user
                    // hasn't already saved a custom one. A non-empty `target.name`
                    // means the user (or a prior fetch) set it — don't clobber.
                    if (!target.name && typeof json.name === 'string' && json.name) {
                        target.name = json.name;
                    }
                } catch (e) {
                    failures++;
                    console.warn('twelvedata quote fetch failed for ' + symbol, e);
                }

                // --- Time-series call (sparkline data) ------------------------------
                // P2-7: only fetch sparkline data on manual refresh (force=true).
                // Automatic refreshes skip this to stay under the free-tier rate limit
                // (~8 credits/min). The existing sparkline is kept as-is.
                if (force) {
                    try {
                        const tsUrl = 'https://api.twelvedata.com/time_series?symbol=' + encodeURIComponent(symbol)
                            + '&interval=1day&outputsize=20'   // ~last 20 trading days
                            + '&apikey=' + encodeURIComponent(key);
                        const res2 = await fetch(tsUrl, { mode: 'cors' });
                        if (!res2.ok) return; // non-fatal — skip sparkline for this symbol
                        const json2 = await res2.json();
                        if (json2 && Array.isArray(json2.values) && json2.values.length >= 2) {
                            if (target) {
                                // values[] is newest-first; reverse so the sparkline reads left→right.
                                target.sparkline = json2.values
                                    .slice(0, 20)
                                    .map(v => parseFloat(v.close))
                                    .reverse();
                            }
                        } else {
                            // No usable series — clear any stale sparkline so it doesn't linger.
                            delete target.sparkline;
                        }
                    } catch (_) { /* time-series is optional; ignore */ }
                }
            }));
        }

        // Stamp the cache so we know how fresh it is. Only update when at least one
        // ticker succeeded — a total failure leaves any prior timestamp intact.
        if (failures < symbols.length) widget.data.updatedAt = Date.now();

        Dashboard.saveFullState();
        renderList();
        if (failures === symbols.length && key) {
            // P2-7: distinguish rate-limit from other failures so the user knows
            // to wait a minute instead of assuming their key is broken.
            if (rateLimited) {
                setStatus('<p class="stock-status-err">Rate limited by Twelve Data — wait a minute and try again. Showing cached prices.</p>');
            } else {
                setStatus('<p class="stock-status-err">Could not load live quotes (check the API key / rate limit). Showing cached prices.</p>');
            }
        } else if (!key) {
            // no-op; handled above
        }
    }

    renderList();
    fetchQuotes();

    // T12: "↻ Refresh quotes" button moved to the card header (app.js).
    // Expose a refresh fn on the widget so the header ↻ icon can trigger it.
    widget.__stocksRefresh = () => { setStatus('<p class="stock-status-loading">Loading…</p>'); fetchQuotes(true); };
}

/**
 * Countdown Widget — counts down to one or more future dates/times.
 *
 * Data: { events: [{ label, when }] }  (when = ISO string or epoch ms)
 */

// P2-9: publish on the shared namespace.
Dashboard.getTwelveDataKey = getTwelveDataKey;
Dashboard.buildSparkline = buildSparkline;
Dashboard.renderStocks = renderStocks;

if (typeof module !== 'undefined' && typeof module.exports !== 'undefined') {
    module.exports = globalThis.Dashboard;
}
