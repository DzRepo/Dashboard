/**
 * currency — widget renderer. Part of the widgets/ split (P2-10).
 * Classic script: top-level functions become globals.
 */


function renderCurrency(widget, container) {
    widget.data = widget.data || {};
    const cfg = widget.config || {};
    const fromCode = (cfg.from || 'USD').toUpperCase();

    // Target currencies: prefer the new list; fall back to a legacy single `to` code.
    let targets = Array.isArray(cfg.toCodes) ? cfg.toCodes.slice() : [];
    if (!targets.length && typeof cfg.to === 'string' && /^[A-Z]{3}$/.test((cfg.to || '').toUpperCase())) {
        targets.push(cfg.to.toUpperCase());
    }

    // Normalise + de-dupe (case-insensitive), drop the base code, cap at a sane number.
    const seen = new Set();
    targets = targets.map(c => String(c).trim().toUpperCase())
                     .filter((c) => /^[A-Z]{3}$/.test(c) && c !== fromCode && !seen.has(c) && (seen.add(c), true))
                     .slice(0, 24);
    if (!targets.length) targets = ['EUR', 'GBP']; // sensible default so the board is never empty

    container.innerHTML = '';

    const wrap = document.createElement('div');
    wrap.className = 'currency-wrap';

    function fmtRate(rate) {
        return parseFloat(Number(rate).toFixed(6)).toString();
    }

    // Human-readable currency names. The frankfurter.dev v1 API does not include
    // them, so we fall back to the browser's built-in Intl data (available in every
    // modern engine); if that is unavailable we just show the 3-letter code.
    // I3: lookups are cached at module scope so repeated renders don't re-construct
    // Intl.DisplayNames for the same locale+code pair.
    const NAME_LOCALES = ['en-US', 'en'];
    function currencyName(code) {
        for (const loc of NAME_LOCALES) {
            const v = cachedDisplayName(loc, code);
            if (v != null) return v;
        }
        return code;
    }

    // ── Render the current state (cached / loading / error) ────────────
    function renderState() {
        const haveRates = widget.data.rates && Object.keys(widget.data.rates).length > 0;
        let bodyHtml;
        if (!haveRates && widget.data.error) {
            bodyHtml = `
                <p class="currency-error">${escapeHtml(widget.data.error)}</p>
                <button type="button" class="currency-btn currency-retry">↻ Retry</button>
            `;
        } else if (!haveRates) {
            bodyHtml = '<p class="currency-loading">Loading rates…</p>';
        } else {
            const rows = targets.map(code => {
                // XE.com chart link for this base→code pair (open in a new tab) — same as before.
                const xeUrl = `https://www.xe.com/en-us/currencycharts/?from=${encodeURIComponent(fromCode)}&to=${encodeURIComponent(code)}`;
                const rate = widget.data.rates[code];
                if (typeof rate !== 'number' || !isFinite(rate)) {
                    return `<div class="currency-row currency-row-missing">
                        <span class="currency-code">${escapeHtml(code)}</span>
                        <span class="currency-rate currency-rate-dim">—</span>
                    </div>`;
                }
                // Show the human-readable name (e.g. "Euro") when available,
                // keeping the code in parentheses for clarity; otherwise just the code.
                const name = currencyName(code);
                const codeLabel = (name && name !== code) ? `${escapeHtml(name)} (${code})` : escapeHtml(code);
                return `
                    <a class="currency-row" href="${xeUrl}" target="_blank" rel="noopener noreferrer"
                       title="$1 ${escapeHtml(fromCode)} = ${fmtRate(rate)} ${escapeHtml(code)} — open chart on XE.com">
                        <span class="currency-code">${codeLabel}</span>
                        <span class="currency-rate">${fmtRate(rate)}</span>
                    </a>`;
            }).join('');

            bodyHtml = `
                ${widget.data.error ? `<p class="currency-error currency-partial">${escapeHtml(widget.data.error)}</p>` : ''}
                <div class="currency-rows" aria-live="polite">
                    <span class="currency-base-note">$1 ${escapeHtml(fromCode)} →</span>
                    ${rows}
                </div>
            `;
        }

        wrap.innerHTML = bodyHtml;
    }

    renderState();
    container.appendChild(wrap);

    // ── Fetch logic ────────────────────────────────────────────────
    async function fetchRates() {
        widget.data.error = null;
        if (!widget.data.rates || Object.keys(widget.data.rates).length === 0) renderState(); // loading
        try {
            // T15: Use the current frankfurter.dev v1 endpoint.
            // Note: v1 uses base + symbols params (not from/to).
            const url = `https://api.frankfurter.dev/v1/latest?base=${encodeURIComponent(fromCode)}&symbols=${encodeURIComponent(targets.join(','))}`;
            const res = await Dashboard.fetchWithTimeout(url, 10000);
            if (!res.ok) throw new Error('HTTP ' + res.status);
            const json = await res.json();

            // frankfurter.app response shape:
            //   { "amount": 1.0, "base": "USD", "date": "2026-…",
            //     "rates": { "EUR": 0.9234 } }
            const rates = {};
            let gotAny = false;
            for (const code of targets) {
                const r = json.rates && json.rates[code];
                if (typeof r === 'number' && isFinite(r) && r > 0) { rates[code] = r; gotAny = true; }
            }
            if (!gotAny) throw new Error('No valid rates in response');

            widget.data.rates     = rates;
            widget.data.updatedAt = Date.now();
            delete widget.data.error;
            renderState();
            if (typeof Dashboard.announceStatus === 'function') {
                const sample = targets.slice(0, 3).map(c => `${c} ${fmtRate(rates[c])}`).join(', ');
                Dashboard.announceStatus(`Currency rates updated: $1 ${fromCode} → ${sample}.`);
            }
        } catch (err) {
            // T15: Include the error detail for easier diagnosis.
            // Appendix A: mention ECB/Frankfurter coverage so users don't assume
            // a network fault when an exotic currency simply isn't in the reference set.
            const msg = err && err.name === 'AbortError'
                ? 'Request timed out. Check your connection.'
                : 'Could not load exchange rate (' + (err.message || err.name || 'unknown') + '). Note: Frankfurter v1 uses ECB reference rates — some currencies may not be covered.';
            widget.data.error = msg;
            console.warn('[Currency] fetchRates failed:', err);
            renderState();
        }
    }

    // ── Button wiring ──────────────────────────────────────────────
    // Convention: the error state (and its Retry button) is rendered by renderState()
    // *after* mount, so wiring it here at once would orphan the listener (P1-4).
    // Expose fetchRates on the widget and let app.js's grid-level delegated click
    // handler dispatch .currency-retry clicks — same pattern as weather above.
    widget.__currencyRetry = fetchRates;

    // Fetch on mount (or use cached rates if fresh — < 1 hour old).
    const CACHE_MS = 60 * 60 * 1000; // 1 hour
    const hasCached = widget.data.rates && Object.keys(widget.data.rates).length > 0;
    if (!(hasCached && widget.data.updatedAt && (Date.now() - widget.data.updatedAt) < CACHE_MS)) {
        fetchRates();
    }
}

/**
 * T7 — Habit Tracker Widget
 *
 * Data shape:
 *   data: {
 *     habits: [{ id, label }],          // the habit list (managed via edit modal)
 *     log:    { "YYYY-MM-DD": [habitId, …] }  // completion log keyed by local date
 *   }
 *
 * Renders a row per habit with a 7-day streak grid (Mon–Sun or last-7-days).
 * Clicking today's cell toggles that habit for the current day.
 */

// P2-9: publish on the shared namespace.
Dashboard.renderCurrency = renderCurrency;

if (typeof module !== 'undefined' && typeof module.exports !== 'undefined') {
    module.exports = globalThis.Dashboard;
}
