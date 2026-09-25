/**
 * Shared helpers — timer registry, escaping, formatting utilities. Part of the
 * widgets/ split (P2-10). Load FIRST among widget files. Classic script.
 */



const widgetTimers = new Map();
function setWidgetTimer(widgetId, intervalId) { widgetTimers.set(widgetId, intervalId); }
function clearWidgetTimer(widgetId) {
    if (widgetTimers.has(widgetId)) {
        clearInterval(widgetTimers.get(widgetId));
        widgetTimers.delete(widgetId);
    }
}
function clearAllWidgetTimers() {
    widgetTimers.forEach((id) => clearInterval(id));
    widgetTimers.clear();
}

/** Escape for use inside HTML attributes (quotes + angle brackets). */
function escapeAttr(value) {
    return String(value == null ? '' : value)
        .replace(/&/g, '&amp;')
        .replace(/"/g, '&quot;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
}

/** Escape for safe insertion into innerHTML. Moved out of the main app bundle (P2-9)
 *  so it's available to widgets and registry.js, which load before app/. */
function escapeHtml(value) {
    return String(value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

/**
 * C5 — shared empty-state helper.
 * Reads the `emptyState` string from the widget's registry entry (single source of truth)
 * and returns it. Falls back to a generic sentence if the entry or field is missing,
 * so new widgets that forget to set one still get consistent copy.
 */
function emptyStateText(widget) {
    const reg = Dashboard.WidgetRegistry;
    const entry = reg && widget ? reg[widget.type] : null;
    return (entry && typeof entry.emptyState === 'string') ? entry.emptyState : 'None yet — open Edit to add some.';
}

/**
 * I3 — module-level cache for Intl.DisplayNames currency-name lookups.
 * Keyed by `${locale}:${code}` so each locale+currency pair is resolved once
 * and reused across every render of the Currency widget (and any future caller).
 */
const _displayNamesCache = new Map();
function cachedDisplayName(locale, code) {
    const key = locale + ':' + code;
    if (_displayNamesCache.has(key)) return _displayNamesCache.get(key);
    let value = null;
    try { value = new Intl.DisplayNames([locale], { type: 'currency' }).of(code); }
    catch (_) { /* unsupported — leave as null */ }
    _displayNamesCache.set(key, value);
    return value;
}

/** Extract a registrable-ish domain from a URL for the Google s2 favicon endpoint. */
function safeDomainForFavicon(url) {
    if (typeof url !== 'string' || !url) return null;
    try {
        const u = new URL(url);
        // Strip www. prefix; keep host as-is otherwise.
        let h = u.hostname.toLowerCase();
        if (h.startsWith('www.')) h = h.slice(4);
        return h || null;
    } catch (e) {
        return null;
    }
}

/** Truncate a string to `max` characters, appending an ellipsis when cut. */
function truncate(str, max) {
    const s = String(str == null ? '' : str);
    if (s.length <= max) return s;
    return s.slice(0, Math.max(0, max - 1)).trimEnd() + '…';
}

/**
 * Fetch with an AbortController timeout. Shared by RSS / weather / stocks / currency.
 * @param {string} targetUrl
 * @param {number} [ms=10000]
 * @param {RequestInit} [init]
 */
function fetchWithTimeout(targetUrl, ms, init) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), ms || 10000);
    const opts = Object.assign({}, init || {}, { signal: controller.signal });
    return fetch(targetUrl, opts).finally(() => clearTimeout(timer));
}

/** Format a Date as the local value expected by <input type="datetime-local">. */
function toLocalInputValue(date) {
    if (!(date instanceof Date) || isNaN(date.getTime())) return '';
    const pad = (n) => String(n).padStart(2, '0');
    return date.getFullYear() + '-' + pad(date.getMonth() + 1) + '-' + pad(date.getDate()) +
        'T' + pad(date.getHours()) + ':' + pad(date.getMinutes());
}

/** B6: shared local-date key (YYYY-MM-DD). Hoisted to module scope so both the load-time pruner and renderHabits can use it without a fragile forward reference. */
function _dateKey(d) {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
}

/** B6: prune habit log entries older than `maxAgeDays` (default 30) from a widget's data. Returns true if anything was removed so the caller can persist. */
function pruneHabitsLog(widget, maxAgeDays = 30) {
    const log = widget && widget.data && typeof widget.data.log === 'object' && widget.data.log !== null ? widget.data.log : null;
    if (!log) return false;
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - maxAgeDays);
    const cutoffKey = _dateKey(cutoff);
    let removed = false;
    for (const key of Object.keys(log)) {
        if (key < cutoffKey) { delete log[key]; removed = true; }
    }
    return removed;
}

/**
 * Widget Component Logic
 */
function createWidgetContent(widget, container) {
    // Prefer the registry so new types need zero edits here.
    const reg = Dashboard.WidgetRegistry;
    const entry = (reg) ? reg[widget.type] : null;

    if (entry && typeof entry.render === 'function') {
        try { entry.render(widget, container); return; } catch(e) { console.warn('registry render failed', e); }
    }

    // If we get here, either the registry entry is missing or its render threw.
    // Log a clear diagnostic so future regressions are diagnosable from DevTools
    // instead of showing only "Unknown widget type" in the card body.
    if (!entry) {
        console.error('[dashboard] WidgetRegistry has no entry for type:', JSON.stringify(widget.type),
            '| registered types:', Object.keys(reg || {}).join(', '));
    } else {
        console.warn('[dashboard] Registry render() threw for type:', widget.type, '(see warning above)');
    }

    // P2-8: the registry is the single source of truth for rendering. The old per-type
    // switch here was dead code — every registered type has a render() method, so the only
    // case that reaches here is an unknown/corrupt type id (already logged above). We show
    // a clear message instead of silently re-implementing renderers.
    const p = document.createElement('p');
    p.textContent = 'Unknown widget type: ' + String(widget && widget.type != null ? widget.type : '');
    container.replaceChildren(p);
}

// P2-9: publish on the shared namespace.
Dashboard.setWidgetTimer     = setWidgetTimer;
Dashboard.clearWidgetTimer   = clearWidgetTimer;
Dashboard.clearAllWidgetTimers = clearAllWidgetTimers;
Dashboard.escapeHtml         = escapeHtml;
Dashboard.escapeAttr         = escapeAttr;
Dashboard.emptyStateText     = emptyStateText;
Dashboard.cachedDisplayName  = cachedDisplayName;
Dashboard.safeDomainForFavicon = safeDomainForFavicon;
Dashboard.truncate           = truncate;
Dashboard.fetchWithTimeout   = fetchWithTimeout;
Dashboard.toLocalInputValue  = toLocalInputValue;
Dashboard._dateKey           = _dateKey;
Dashboard.pruneHabitsLog     = pruneHabitsLog;
Dashboard.createWidgetContent = createWidgetContent;

if (typeof module !== 'undefined' && typeof module.exports !== 'undefined') {
    module.exports = globalThis.Dashboard;
}
