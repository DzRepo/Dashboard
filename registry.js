/**
 * Widget Registry
 * ---------------
 * Single source of truth for every widget type. Each entry provides:
 *   label      – display name (add-widget modal, edit modal)
 *   defaults() – returns { config, data } for a new widget
 *   render()   – (widget, container) => void  (pure DOM builder)
 *   editFields() – (widget) => HTML string for the edit modal body
 *   applyEdit()  – optional: (widget, formEl) => void. Persists the type-specific edit
 *                   modal fields onto widget.config / widget.data, then the generic Save
 *                   handler in app.js saves + re-renders. This is what makes the registry
 *                   the single source of truth (P2-8): each type owns defaults → render →
 *                   edit UI → save/validate. Types with no modal-specific fields (e.g.
 *                   notes) omit it; the generic handler still saves title/size/danger-zone.
 *   sanitize() – (raw) => clean widget object | null
 *   emptyState – optional: shared empty-state copy (C5); rendered when a list-type
 *                widget has no rows yet. Kept in one place so new widgets inherit it.
 *   hint       – optional: short description shown under the add-widget picker button (C7).
 *
 * Adding a new widget = one new entry here + one render function.
 * Zero edits to app.js / storage.js / widgets.js core logic.
 */

// P2-9: publish the widget registry on the shared namespace created by storage.js
// (Dashboard.WidgetRegistry). The whole module body lives in an IIFE so nothing leaks
// to the global scope; a UMD footer at the bottom makes it `require()`-able in Node.
(function (root) {
    'use strict';

    root.Dashboard = root.Dashboard || {};

/**
 * Build the search URL for a Perplexity-style widget based on its configured engine.
 * Engines: perplexity (default), google, bing, ddg. All are keyless + CORS-friendly
 * because they're just opened in a new tab — no fetch involved.
 */
function buildSearchUrl(engine, query) {
    const q = encodeURIComponent(query);
    switch (engine) {
        case 'google': return `https://www.google.com/search?q=${q}`;
        case 'bing':   return `https://www.bing.com/search?q=${q}`;
        case 'ddg':    return `https://duckduckgo.com/?q=${q}`;
        default:       return `https://www.perplexity.ai/search/?q=${q}`; // perplexity
    }
}

const WidgetRegistry = {};

// ── Shortcuts ──────────────────────────────────────────────────────────────
WidgetRegistry['shortcuts'] = {
    label: 'Shortcuts',
    defaults() {
        return { config: {}, data: { items: [] } };
    },
    render: (widget, container) => root.Dashboard.renderShortcuts(widget, container),
    editFields(widget) {
        return `
            <div class="settings-group">
                <label>Add a link (saved immediately):</label>
                <div class="shortcuts-controls shortcut-add-form">
                    <input type="text" placeholder="Label" id="shortcut-new-label">
                    <input type="url" placeholder="URL (https://…)" id="shortcut-new-url">
                    <input type="text" placeholder="Description (optional)" id="shortcut-new-desc">
                </div>
                <button type="button" id="shortcut-add-link" style="margin-top:8px;">＋ Add link</button>
            </div>
        `;
    },
    sanitize(raw) {
        if (!raw || typeof raw !== 'object') return null;
        const items = Array.isArray(raw.data?.items) ? raw.data.items : [];
        // v3 migration: backfill clickCount for shortcuts added before that field existed.
        return {
            id: raw.id || genWidgetId(),
            type: 'shortcuts',
            title: raw.title || 'Shortcuts',
            position: typeof raw.position === 'number' ? raw.position : 0,
            span: [1, 2, 3].includes(raw.span) ? raw.span : 1,
            config: raw.config || {},
            data: {
                items: items
                    .filter(it => it && typeof it === 'object' && root.Dashboard.Storage.isValidHttpUrl(it.url))
                    .map(it => ({
                        label: it.label || '',
                        url: it.url,
                        description: it.description || '',
                        // Default to opening in a new tab; only an explicit `false` opts out.
                        openInNewTab: it.openInNewTab !== false,
                        icon: typeof it.icon === 'string' ? it.icon : '',
                        clickCount: Number.isFinite(it.clickCount) ? Math.max(0, it.clickCount | 0) : 0
                    }))
            }
        };
    }
};

// ── Lists (Todo) ───────────────────────────────────────────────────────────
WidgetRegistry['lists'] = {
    label: 'Lists / Todo',
    defaults() {
        return { config: {}, data: { items: [], showCompleted: true, sortByDueDate: false } };
    },
    render: (widget, container) => root.Dashboard.renderLists(widget, container),
    applyEdit(widget, modalBody) {
        // Persist the display options (the "Clear completed" button is wired separately
        // in app.js and saves immediately, so it's not touched here).
        widget.data = widget.data || {};
        const showEl = document.getElementById('edit-lists-show-completed');
        if (showEl) widget.data.showCompleted = showEl.checked;
        const sortEl = document.getElementById('edit-lists-sort-due');
        if (sortEl) widget.data.sortByDueDate = sortEl.checked;
    },
    editFields(widget) {
        const data = widget.data || {};
        const showCompleted = data.showCompleted !== false; // default true
        const sortByDueDate = !!data.sortByDueDate;
        return `
            <div class="settings-group">
                <label>Display options:</label>
                <label class="checkbox-label" style="display:block;margin-top:6px;">
                    <input type="checkbox" id="edit-lists-show-completed" ${showCompleted ? 'checked' : ''}> Show completed items
                </label>
                <label class="checkbox-label" style="display:block;margin-top:4px;">
                    <input type="checkbox" id="edit-lists-sort-due" ${sortByDueDate ? 'checked' : ''}> Sort by due date (earliest first)
                </label>
            </div>
            <div class="settings-group">
                <button type="button" id="edit-lists-clear-completed" class="danger">Clear completed items</button>
                <p style="font-size:11px;opacity:.7;margin-top:4px;">Removes every checked item from this list. Saved immediately.</p>
            </div>
        `;
    },
    sanitize(raw) {
        if (!raw || typeof raw !== 'object') return null;
        const items = Array.isArray(raw.data?.items) ? raw.data.items : [];
        return {
            id: raw.id || genWidgetId(),
            type: 'lists',
            title: raw.title || 'Lists',
            position: typeof raw.position === 'number' ? raw.position : 0,
            span: [1, 2, 3].includes(raw.span) ? raw.span : 1,
            config: raw.config || {},
            data: {
                items: items
                    .filter(it => it && typeof it === 'object' && typeof it.text === 'string')
                    .map(it => ({
                        text: it.text,
                        completed: !!it.completed,
                        dueDate: (typeof it.dueDate === 'string' && it.dueDate) ? it.dueDate : null,
                        note: typeof it.note === 'string' ? it.note : ''
                    })),
                showCompleted: typeof raw.data?.showCompleted === 'boolean' ? raw.data.showCompleted : true,
                sortByDueDate: !!raw.data?.sortByDueDate
            }
        };
    }
};

// ── World Clock ────────────────────────────────────────────────────────────
WidgetRegistry['clock'] = {
    label: 'World Clock',
    emptyState: 'None yet — open Edit to add some.',
    hint: 'Show the current time in multiple cities with day-offset badges.',
    defaults() {
        return {
            config: { formatType: 12, showSeconds: false, showDate: true },
            data: { times: [{ label: 'My Time', timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'America/Denver' }] }
        };
    },
    render: (widget, container) => root.Dashboard.renderClock(widget, container),
    applyEdit(widget, modalBody) {
        widget.config = widget.config || {};
        const fmtEl = document.getElementById('edit-clock-format');
        if (fmtEl) widget.config.formatType = parseInt(fmtEl.value, 10);
        const secEl = document.getElementById('edit-clock-seconds');
        if (secEl) widget.config.showSeconds = secEl.checked;
        const dateEl = document.getElementById('edit-clock-date');
        if (dateEl) widget.config.showDate = dateEl.checked;

        // Collect the edited time rows (label + timezone).
        const times = [];
        modalBody.querySelectorAll('.clock-time-row').forEach(row => {
            const label = row.querySelector('.clock-time-label');
            const tz    = row.querySelector('.clock-time-zone');
            if (!label || !tz) return;
            const tzVal = (tz.value || '').trim();
            if (!tzVal) return; // skip rows without a timezone
            times.push({ label: (label.value || '').trim(), timezone: tzVal });
        });
        widget.data = widget.data || {};
        widget.data.times = times;
    },
    editFields(widget) {
        const cfg = widget.config || {};
        const times = widget.data?.times || [];
        const rows = times.map(entry => `
            <div class="clock-time-row">
                <input type="text" class="clock-time-label" placeholder="Label (e.g. Home)" value="${root.Dashboard.escapeHtml(entry.label || '')}">
                <input type="text" class="clock-time-zone" placeholder="Timezone (e.g. America/New_York)" value="${root.Dashboard.escapeHtml(entry.timezone || '')}">
                <button type="button" class="clock-remove-entry" title="Remove entry">×</button>
            </div>
        `).join('');
        return `
            <div class="settings-group">
                <label>Time format:</label>
                <select id="edit-clock-format">
                    <option value="12" ${cfg.formatType === 12 ? 'selected' : ''}>12-hour</option>
                    <option value="24" ${cfg.formatType === 24 ? 'selected' : ''}>24-hour</option>
                </select>
            </div>
            <div class="settings-group">
                <label class="checkbox-label">
                    <input type="checkbox" id="edit-clock-seconds" ${cfg.showSeconds ? 'checked' : ''}> Show seconds
                </label>
            </div>
            <div class="settings-group">
                <label class="checkbox-label">
                    <input type="checkbox" id="edit-clock-date" ${cfg.showDate !== false ? 'checked' : ''}> Show date
                </label>
            </div>
            <div class="settings-group">
                <label>Times (each with its own label and timezone):</label>
                <div id="clock-times-editor" class="clock-times-editor">
                    ${rows || '<p class="hint" style="font-size:12px;opacity:0.7;">No times yet.</p>'}
                </div>
                <button type="button" id="clock-add-time" style="margin-top:8px;">+ Add Time</button>
            </div>
        `;
    },
    sanitize(raw) {
        if (!raw || typeof raw !== 'object') return null;
        const times = Array.isArray(raw.data?.times) ? raw.data.times : [];
        return {
            id: raw.id || genWidgetId(),
            type: 'clock',
            title: raw.title || 'World Clock',
            position: typeof raw.position === 'number' ? raw.position : 0,
            span: [1, 2, 3].includes(raw.span) ? raw.span : 1,
            config: {
                formatType: raw.config?.formatType || 12,
                showSeconds: !!raw.config?.showSeconds,
                showDate: raw.config?.showDate !== false
            },
            data: {
                times: times
                    .filter(t => t && typeof t === 'object' && typeof t.timezone === 'string')
                    .map(t => ({
                        label: t.label || t.timezone,
                        timezone: t.timezone
                    }))
            }
        };
    }
};

// ── Search Widget (multi-engine) ───────────────────────────────────────────
// C3: type id renamed from 'perplexity' → 'search'. The widget is engine-neutral
// (Perplexity, Google, Bing, DDG); the old name leaked into saved data, palette,
// CSS classes and storage fallbacks. A one-line migration in storage.js + an alias
// in sanitizeWidget() keep old exports importable.
WidgetRegistry['search'] = {
    label: 'Search Widget',
    defaults() {
        return {
            config: { title: 'Search', openInNewTab: true, engine: 'perplexity' },
            data: { recentQueries: [] }
        };
    },
    render: (widget, container) => root.Dashboard.renderPerplexity(widget, container),
    applyEdit(widget, modalBody) {
        // Title comes from the shared #edit-widget-title field (handled by the generic
        // Save handler), so only the engine + new-tab flag are persisted here.
        widget.config = widget.config || {};
        const engineEl = document.getElementById('edit-engine');
        if (engineEl) widget.config.engine = engineEl.value;
        const openTabEl = document.getElementById('edit-open-tab');
        if (openTabEl) widget.config.openInNewTab = openTabEl.checked;
    },
    editFields(widget) {
        const cfg = widget.config || {};
        const engines = [
            { id: 'perplexity', label: 'Perplexity AI' },
            { id: 'google', label: 'Google' },
            { id: 'bing', label: 'Bing' },
            { id: 'ddg', label: 'DuckDuckGo' }
        ];
        const engineOptions = engines.map(e =>
            `<option value="${e.id}" ${cfg.engine === e.id ? 'selected' : ''}>${e.label}</option>`
        ).join('');
        return `
            <div class="settings-group">
                <label>Search engine:</label>
                <select id="edit-engine">
                    ${engineOptions}
                </select>
            </div>
            <div class="settings-group">
                <label class="checkbox-label">
                    <input type="checkbox" id="edit-open-tab" ${cfg.openInNewTab !== false ? 'checked' : ''}> Open results in new tab
                </label>
            </div>
        `;
    },
    sanitize(raw) {
        if (!raw || typeof raw !== 'object') return null;
        // C3 alias: accept legacy 'perplexity' imports so old exports still work.
        if (raw.type === 'perplexity') raw = { ...raw, type: 'search' };
        return {
            id: raw.id || genWidgetId(),
            type: 'search',
            title: raw.title || 'Search Widget',
            position: typeof raw.position === 'number' ? raw.position : 0,
            span: [1, 2, 3].includes(raw.span) ? raw.span : 1,
            config: {
                title: raw.config?.title || 'Search',
                openInNewTab: raw.config?.openInNewTab !== false,
                engine: ['perplexity', 'google', 'bing', 'ddg'].includes(raw.config?.engine) ? raw.config.engine : 'perplexity'
            },
            data: {
                recentQueries: Array.isArray(raw.data?.recentQueries)
                    ? raw.data.recentQueries.filter(q => typeof q === 'string').slice(0, 10)
                    : []
            }
        };
    }
};

// ── Weather ────────────────────────────────────────────────────────────────
WidgetRegistry['weather'] = {
    label: 'Weather',
    hint: 'Current conditions + 5-day forecast from Open-Meteo (keyless).',
    defaults() {
        return {
            config: { units: 'metric', showForecast: true, showHumidity: true, showHourly: true },
            data: { lat: null, lon: null, city: 'Your Location' }
        };
    },
    render: (widget, container) => root.Dashboard.renderWeather(widget, container),
    applyEdit(widget, modalBody) {
        const readNum = (id) => {
            const el = document.getElementById(id);
            if (!el || el.value.trim() === '') return null;
            const n = parseFloat(el.value);
            return isNaN(n) ? null : n;
        };

        widget.config = widget.config || {};
        widget.data = widget.data || {};

        const cityEl = document.getElementById('edit-weather-city');
        if (cityEl) widget.data.city = cityEl.value.trim() || 'Your Location';

        const lat = readNum('edit-weather-lat');
        const lon = readNum('edit-weather-lon');
        // Only persist a coordinate pair when both are present and in range.
        if (lat != null && lon != null && Math.abs(lat) <= 90 && Math.abs(lon) <= 180) {
            widget.data.lat = lat;
            widget.data.lon = lon;
        }

        const unitsEl = document.getElementById('edit-weather-units');
        if (unitsEl) widget.config.units = unitsEl.value === 'imperial' ? 'imperial' : 'metric';

        const forecastEl = document.getElementById('edit-weather-forecast');
        if (forecastEl) widget.config.showForecast = forecastEl.checked;

        // B7: persist the two previously-dead flags now that they're exposed in the editor.
        const humidityEl = document.getElementById('edit-weather-humidity');
        if (humidityEl) widget.config.showHumidity = humidityEl.checked;
        const hourlyEl = document.getElementById('edit-weather-hourly');
        if (hourlyEl) widget.config.showHourly = hourlyEl.checked;
    },
    editFields(widget) {
        const cfg = widget.config || {};
        const d = widget.data || {};
        return `
            <div class="settings-group">
                <label>City (display name):</label>
                <input type="text" id="edit-weather-city" value="${root.Dashboard.escapeHtml(d.city || '')}" placeholder="e.g. Denver">
            </div>
            <div class="settings-group">
                <label>Latitude:</label>
                <input type="number" step="0.0001" id="edit-weather-lat" value="${d.lat ?? ''}" placeholder="e.g. 39.7392">
            </div>
            <div class="settings-group">
                <label>Longitude:</label>
                <input type="number" step="0.0001" id="edit-weather-lon" value="${d.lon ?? ''}" placeholder="e.g. -104.9903">
            </div>
            <div class="settings-group">
                <label>Units:</label>
                <select id="edit-weather-units">
                    <option value="metric" ${cfg.units === 'metric' ? 'selected' : ''}>Metric (°C)</option>
                    <option value="imperial" ${cfg.units === 'imperial' ? 'selected' : ''}>Imperial (°F)</option>
                </select>
            </div>
            <div class="settings-group">
                <label class="checkbox-label">
                    <input type="checkbox" id="edit-weather-forecast" ${cfg.showForecast !== false ? 'checked' : ''}> Show 5-day forecast
                </label>
            </div>
            <!-- B7: expose the two previously-dead config flags as real toggles. -->
            <div class="settings-group">
                <label class="checkbox-label">
                    <input type="checkbox" id="edit-weather-humidity" ${cfg.showHumidity !== false ? 'checked' : ''}> Show humidity + UV index
                </label>
            </div>
            <div class="settings-group">
                <label class="checkbox-label">
                    <input type="checkbox" id="edit-weather-hourly" ${cfg.showHourly !== false ? 'checked' : ''}> Show hourly strip (next 24h)
                </label>
            </div>
        `;
    },
    sanitize(raw) {
        if (!raw || typeof raw !== 'object') return null;
        return {
            id: raw.id || genWidgetId(),
            type: 'weather',
            title: raw.title || 'Weather',
            position: typeof raw.position === 'number' ? raw.position : 0,
            span: [1, 2, 3].includes(raw.span) ? raw.span : 2,
            config: {
                units: raw.config?.units === 'imperial' ? 'imperial' : 'metric',
                showForecast: raw.config?.showForecast !== false,
                // B7: backfill the two previously-dead flags so old imports keep working.
                showHumidity: raw.config?.showHumidity !== false,
                showHourly:   raw.config?.showHourly   !== false
            },
            data: {
                lat: typeof raw.data?.lat === 'number' ? raw.data.lat : null,
                lon: typeof raw.data?.lon === 'number' ? raw.data.lon : null,
                city: raw.data?.city || 'Your Location'
            }
        };
    }
};

// ── Notes / Scratchpad ─────────────────────────────────────────────────────
WidgetRegistry['notes'] = {
    label: 'Notes / Scratchpad',
    defaults() {
        return { config: {}, data: { text: '', updatedAt: null } };
    },
    render: (widget, container) => root.Dashboard.renderNotes(widget, container),
    editFields() {
        return '';
    },
    sanitize(raw) {
        if (!raw || typeof raw !== 'object') return null;
        return {
            id: raw.id || genWidgetId(),
            type: 'notes',
            title: raw.title || 'Notes',
            position: typeof raw.position === 'number' ? raw.position : 0,
            span: [1, 2, 3].includes(raw.span) ? raw.span : 1,
            config: raw.config || {},
            data: {
                text: typeof raw.data?.text === 'string' ? raw.data.text : '',
                updatedAt: raw.data?.updatedAt || null
            }
        };
    }
};

// ── Stock Watchlist ────────────────────────────────────────────────────────
WidgetRegistry['stocks'] = {
    label: 'Stock Watchlist',
    emptyState: 'None yet — open Edit to add some.',
    hint: 'Track live prices and daily change for a set of tickers.',
    defaults() {
        return { config: {}, data: { symbols: [] } };
    },
    render: (widget, container) => root.Dashboard.renderStocks(widget, container),
    applyEdit(widget, modalBody) {
        // Persist the edited ticker list.
        widget.data = widget.data || {};
        const symbols = [];
        modalBody.querySelectorAll('.stock-symbol-row').forEach(row => {
            const sym = row.querySelector('.stock-symbol-input');
            const nameEl = row.querySelector('.stock-name-input');
            if (!sym) return;
            const s = (sym.value || '').trim().toUpperCase();
            if (!s) return; // skip blank rows
            symbols.push({ symbol: s, name: (nameEl && nameEl.value.trim()) || '' });
        });
        widget.data.symbols = symbols;
    },
    editFields(widget) {
        const symbols = widget.data?.symbols || [];
        const rows = symbols.map(s => `
            <div class="stock-symbol-row">
                <input type="text" class="stock-symbol-input" value="${root.Dashboard.escapeHtml(s.symbol)}" placeholder="TICKER">
                <input type="text" class="stock-name-input" value="${root.Dashboard.escapeHtml(s.name || '')}" placeholder="Company name">
                <button type="button" class="stock-remove-entry" title="Remove">×</button>
            </div>
        `).join('');
        return `
            <div class="settings-group">
                <label>Tickers:</label>
                <div id="stock-symbols-editor" class="stock-symbols-editor">
                    ${rows || '<p class="hint" style="font-size:12px;opacity:0.7;">No tickers yet.</p>'}
                </div>
                <button type="button" id="stock-add-symbol" style="margin-top:8px;">+ Add Ticker</button>
            </div>
        `;
    },
    sanitize(raw) {
        if (!raw || typeof raw !== 'object') return null;
        const symbols = Array.isArray(raw.data?.symbols) ? raw.data.symbols : [];
        return {
            id: raw.id || genWidgetId(),
            type: 'stocks',
            title: raw.title || 'Stock Watchlist',
            position: typeof raw.position === 'number' ? raw.position : 0,
            span: [1, 2, 3].includes(raw.span) ? raw.span : 1,
            config: raw.config || {},
            data: {
                symbols: symbols
                    .filter(s => s && typeof s === 'object' && typeof s.symbol === 'string')
                    .map(s => {
                        const out = {
                            symbol: s.symbol.toUpperCase(),
                            name: s.name || '',
                            lastPrice: typeof s.lastPrice === 'number' ? s.lastPrice : null
                        };
                        if (typeof s.change === 'number' && isFinite(s.change)) out.change = s.change;
                        if (typeof s.changePct === 'number' && isFinite(s.changePct)) out.changePct = s.changePct;
                        if (Array.isArray(s.sparkline)) {
                            const spark = s.sparkline.filter(n => typeof n === 'number' && isFinite(n));
                            if (spark.length) out.sparkline = spark;
                        }
                        return out;
                    }),
                ...(typeof raw.data?.updatedAt === 'number' && isFinite(raw.data.updatedAt)
                    ? { updatedAt: raw.data.updatedAt }
                    : {})
            }
        };
    }
};

// ── Date / Time Countdown ──────────────────────────────────────────────────
WidgetRegistry['countdown'] = {
    label: 'Countdown',
    emptyState: 'None yet — open Edit to add some.',
    hint: 'Live countdowns to dates and times you care about.',
    defaults() {
        return { config: {}, data: { events: [] } };
    },
    render: (widget, container) => root.Dashboard.renderCountdown(widget, container),
    applyEdit(widget, modalBody) {
        // Persist the edited event list (label + when).
        widget.data = widget.data || {};
        const events = [];
        modalBody.querySelectorAll('.countdown-event-row').forEach(row => {
            const labelEl = row.querySelector('.countdown-ev-label');
            const dtEl  = row.querySelector('.countdown-ev-dt');
            if (!labelEl || !dtEl) return;
            const whenVal = (dtEl.value || '').trim();
            // datetime-local is local time; new Date() parses it as local.
            const whenMs = whenVal ? new Date(whenVal).getTime() : NaN;
            if (!Number.isFinite(whenMs)) return; // skip rows without a valid date
            events.push({ label: (labelEl.value || '').trim(), when: whenMs });
        });
        widget.data.events = events;
    },
    editFields(widget) {
        const d = widget.data || {};
        if (!Array.isArray(d.events)) d.events = [];
        const rows = d.events.map(ev => `
            <div class="countdown-event-row">
                <input type="text" class="countdown-ev-label" placeholder="Label (e.g. Launch)" value="${root.Dashboard.escapeHtml(ev.label || '')}">
                <input type="datetime-local" class="countdown-ev-dt" step="60" value="${root.Dashboard.escapeAttr(ev.when ? root.Dashboard.toLocalInputValue(new Date(ev.when)) : '')}">
                <button type="button" class="countdown-remove-entry" title="Remove event">×</button>
            </div>
        `).join('');
        return `
            <div class="settings-group">
                <label>Events (each with a label and a date &amp; time):</label>
                <p class="hint" style="font-size:12px;opacity:0.7;margin-top:4px;">Times are entered in your local timezone.</p>
                <div id="countdown-events-editor" class="countdown-events-editor">
                    ${rows || '<p class="hint" style="font-size:12px;opacity:0.7;">No events yet.</p>'}
                </div>
                <button type="button" id="countdown-add-event" style="margin-top:8px;">+ Add Event</button>
            </div>
        `;
    },
    sanitize(raw) {
        if (!raw || typeof raw !== 'object') return null;
        const events = Array.isArray(raw.data?.events) ? raw.data.events : [];
        return {
            id: raw.id || genWidgetId(),
            type: 'countdown',
            title: raw.title || 'Countdown',
            position: typeof raw.position === 'number' ? raw.position : 0,
            span: [1, 2, 3].includes(raw.span) ? raw.span : 1,
            config: (raw.config && typeof raw.config === 'object') ? raw.config : {},
            data: {
                events: events
                    .filter(ev => ev && typeof ev === 'object' && ev.when)
                    .map(ev => ({
                        label: typeof ev.label === 'string' ? ev.label : '',
                        when: (typeof ev.when === 'number' || typeof ev.when === 'string') ? ev.when : null
                    }))
            }
        };
    }
};

// ── RSS Feed Reader ────────────────────────────────────────────────────────
WidgetRegistry['rss'] = {
    label: 'RSS / News',
    emptyState: 'None yet — open Edit to add some.',
    hint: 'Read RSS feeds inline; failed feeds show their error.',
    defaults() {
        return { config: {}, data: { feeds: [] } };
    },
    render: (widget, container) => root.Dashboard.renderRss(widget, container),
    applyEdit(widget, modalBody) {
        // Persist the edited feed list (optional label + url).
        widget.data = widget.data || {};
        const feeds = [];
        modalBody.querySelectorAll('.rss-feed-row').forEach(row => {
            const labelEl = row.querySelector('.rss-feed-label');
            const urlEl   = row.querySelector('.rss-feed-url');
            if (!urlEl) return;
            let url = (urlEl.value || '').trim();
            if (!url) return; // skip rows without a URL
            if (!/^https?:\/\//i.test(url)) url = 'https://' + url;
            if (!root.Dashboard.Storage.isValidHttpUrl(url)) {
                window.alert('Invalid feed URL: "' + url + '" (must be http/https).');
                return;
            }
            feeds.push({ label: (labelEl && labelEl.value.trim()) || '', url, maxItems: 8 });
        });
        widget.data.feeds = feeds;
    },
    editFields(widget) {
        const d = widget.data || {};
        if (!Array.isArray(d.feeds)) d.feeds = [];
        const rows = d.feeds.map(f => `
            <div class="rss-feed-row">
                <input type="text" class="rss-feed-label" placeholder="Label (optional)" value="${root.Dashboard.escapeHtml(f.label || '')}">
                <input type="url" class="rss-feed-url" placeholder="Feed URL (https://…/feed.xml)" value="${root.Dashboard.escapeAttr(f.url || '')}">
                <button type="button" class="rss-remove-entry" title="Remove feed">×</button>
            </div>
        `).join('');
        return `
            <div class="settings-group">
                <label>Feeds (each with an optional label and a URL):</label>
                <p class="hint" style="font-size:12px;opacity:0.7;margin-top:4px;">Some feeds block cross-origin requests; if one fails, the widget shows its error.</p>
                <div id="rss-feeds-editor" class="rss-feeds-editor">
                    ${rows || '<p class="hint" style="font-size:12px;opacity:0.7;">No feeds yet.</p>'}
                </div>
                <button type="button" id="rss-add-feed" style="margin-top:8px;">+ Add Feed</button>
            </div>
        `;
    },
    sanitize(raw) {
        if (!raw || typeof raw !== 'object') return null;
        const feeds = Array.isArray(raw.data?.feeds) ? raw.data.feeds : [];
        return {
            id: raw.id || genWidgetId(),
            type: 'rss',
            title: raw.title || 'RSS / News',
            position: typeof raw.position === 'number' ? raw.position : 0,
            span: [1, 2, 3].includes(raw.span) ? raw.span : 1,
            config: (raw.config && typeof raw.config === 'object') ? raw.config : {},
            data: {
                feeds: feeds
                    .filter(f => f && typeof f === 'object' && root.Dashboard.Storage.isValidHttpUrl(f.url))
                    .map(f => ({
                        label: typeof f.label === 'string' ? f.label : '',
                        url: f.url,
                        maxItems: Number.isFinite(f.maxItems) ? Math.min(50, Math.max(1, f.maxItems | 0)) : 8
                    }))
            }
        };
    }
};

// ── T7: Pomodoro / Focus Timer ─────────────────────────────────────────
WidgetRegistry['pomodoro'] = {
    label: 'Pomodoro / Focus',
    defaults() {
        return {
            config: { focusMin: 25, shortBreakMin: 5, longBreakMin: 15, sessionsUntilLong: 4 },
            data:   { running: false, mode: 'focus', remainingSec: 25 * 60, completedSessions: 0 }
        };
    },
    render: (widget, container) => root.Dashboard.renderPomodoro(widget, container),
    applyEdit(widget, modalBody) {
        // Persist duration settings. The running timer state (mode / remainingSec /
        // completedSessions) is managed by the widget itself and untouched here.
        widget.config = widget.config || {};
        const readNum = (id, fallback) => {
            const el = document.getElementById(id);
            if (!el) return null;
            const n = parseInt(el.value, 10);
            return Number.isFinite(n) && n >= 1 ? n : fallback;
        };
        const f = readNum('pom-focus-min', 25);   if (f != null) widget.config.focusMin = f;
        const s = readNum('pom-short-brk', 5);    if (s != null) widget.config.shortBreakMin = s;
        const l = readNum('pom-long-brk', 15);    if (l != null) widget.config.longBreakMin = l;
        const u = readNum('pom-sessions-until-long', 4);
        if (u != null && u >= 2) widget.config.sessionsUntilLong = u;
    },
    editFields(widget) {
        const c = widget.config || {};
        return `
            <div class="settings-group">
                <label>Focus duration (minutes):</label>
                <input type="number" min="1" max="120" id="pom-focus-min" value="${c.focusMin || 25}">
            </div>
            <div class="settings-group">
                <label>Short break (minutes):</label>
                <input type="number" min="1" max="60" id="pom-short-brk" value="${c.shortBreakMin || 5}">
            </div>
            <div class="settings-group">
                <label>Long break (minutes):</label>
                <input type="number" min="1" max="60" id="pom-long-brk" value="${c.longBreakMin || 15}">
            </div>
            <div class="settings-group">
                <label>Sessions before long break:</label>
                <input type="number" min="2" max="20" id="pom-sessions-until-long" value="${c.sessionsUntilLong || 4}">
            </div>
        `;
    },
    sanitize(raw) {
        if (!raw || typeof raw !== 'object') return null;
        const cfg = (raw.config && typeof raw.config === 'object') ? raw.config : {};
        const d   = (raw.data   && typeof raw.data   === 'object') ? raw.data   : {};
        return {
            id: raw.id || genWidgetId(),
            type: 'pomodoro',
            title: raw.title || 'Pomodoro / Focus',
            position: typeof raw.position === 'number' ? raw.position : 0,
            span: [1, 2, 3].includes(raw.span) ? raw.span : 1,
            config: {
                focusMin:          Math.max(1, Number(cfg.focusMin)        || 25),
                shortBreakMin:     Math.max(1, Number(cfg.shortBreakMin)   || 5),
                longBreakMin:      Math.max(1, Number(cfg.longBreakMin)    || 15),
                sessionsUntilLong: Math.max(2, Number(cfg.sessionsUntilLong) || 4)
            },
            data: {
                running:           d.running === true,
                mode:              ['focus','short','long'].includes(d.mode) ? d.mode : 'focus',
                remainingSec:      (typeof d.remainingSec === 'number' && isFinite(d.remainingSec) && d.remainingSec >= 0)
                                    ? Math.round(d.remainingSec) : 25 * 60,
                completedSessions: (typeof d.completedSessions === 'number' && d.completedSessions >= 0)
                                    ? Math.floor(d.completedSessions) : 0,
                // Keep wall-clock target when running so import/reload can catch up.
                ...(d.running === true && typeof d.endTime === 'number' && isFinite(d.endTime)
                    ? { endTime: d.endTime }
                    : {})
            }
        };
    }
};

// ── T7: Currency Converter ─────────────────────────────────────────────
WidgetRegistry['currency'] = {
    label: 'Currency Converter',
    defaults() {
        return {
            // Base currency you convert FROM ($1 of this) + the list of foreign
            // currencies to show. Each row shows $1 base → that currency's rate.
            config: { from: 'USD', toCodes: ['EUR','GBP','JPY'] },
            data:   { rates: {}, updatedAt: null }
        };
    },
    render: (widget, container) => root.Dashboard.renderCurrency(widget, container),
    applyEdit(widget, modalBody) {
        // Persist base currency + the list of foreign codes (de-duped, base excluded).
        widget.config = widget.config || {};
        const fromEl = document.getElementById('currency-from-code');
        if (fromEl) {
            const f = String(fromEl.value).trim().toUpperCase();
            if (/^[A-Z]{3}$/.test(f)) widget.config.from = f; else widget.config.from = 'USD';
        }
        const codes = [];
        const seenC = new Set();
        modalBody.querySelectorAll('.currency-code-input').forEach(inp => {
            const c = String(inp.value).trim().toUpperCase();
            if (/^[A-Z]{3}$/.test(c) && c !== widget.config.from && !seenC.has(c)) { codes.push(c); seenC.add(c); }
        });
        widget.config.toCodes = codes.length ? codes : ['EUR', 'GBP'];
    },
    editFields(widget) {
        const c = widget.config || {};
        const curFrom  = (c.from || 'USD').toUpperCase();
        // Seed the list from toCodes, falling back to a legacy single `to` code.
        let codes = Array.isArray(c.toCodes) ? c.toCodes.slice() : [];
        if (!codes.length && typeof c.to === 'string' && /^[A-Z]{3}$/.test((c.to || '').toUpperCase())) {
            codes.push(c.to.toUpperCase());
        }
        const rows = (codes.length ? codes : ['EUR','GBP']).map(code => `
            <div class="currency-code-row">
                <input type="text" maxlength="3" class="currency-code-input"
                       style="text-transform:uppercase; width:72px;"
                       value="${root.Dashboard.escapeHtml(String(code).toUpperCase())}" aria-label="Currency code">
                <button type="button" class="currency-remove-entry" title="Remove">×</button>
            </div>
        `).join('');
        return `
            <div class="settings-group">
                <label>Base currency (you convert $1 of this):</label>
                <input type="text" maxlength="3" style="text-transform:uppercase; width:80px;"
                       id="currency-from-code" value="${root.Dashboard.escapeHtml(curFrom)}">
            </div>
            <div class="settings-group">
                <label>Foreign currencies to show (one code per row):</label>
                <p style="font-size:12px;opacity:.7;margin-top:4px;">Each shows the rate for $1 ${root.Dashboard.escapeHtml(curFrom)} → that currency, and links out to XE.com. Note: uses ECB reference rates (Frankfurter v1) — covers ~30 major currencies; some exotics may not be available.</p>
                <div id="currency-codes-editor" class="currency-codes-editor">
                    ${rows}
                </div>
                <button type="button" id="currency-add-code" style="margin-top:8px;">＋ Add currency</button>
            </div>
        `;
    },
    sanitize(raw) {
        if (!raw || typeof raw !== 'object') return null;
        const cfg = (raw.config && typeof raw.config === 'object') ? raw.config : {};
        const d   = (raw.data   && typeof raw.data   === 'object') ? raw.data   : {};
        // Normalise currency codes to 3-letter uppercase.
        const normCode = (v, fallback) => {
            const s = String(v || '').trim().toUpperCase();
            return /^[A-Z]{3}$/.test(s) ? s : fallback;
        };
        const fromCode = normCode(cfg.from, 'USD');

        // Build the target list. Prefer toCodes; migrate a legacy single `to` code.
        let codes = [];
        if (Array.isArray(cfg.toCodes)) {
            codes = cfg.toCodes.map(v => String(v).trim().toUpperCase()).filter(s => /^[A-Z]{3}$/.test(s));
        } else if (typeof cfg.to === 'string' && /^[A-Z]{3}$/.test((cfg.to || '').toUpperCase())) {
            codes = [cfg.to.toUpperCase()];
        }
        // De-dupe, drop the base code.
        const seenC = new Set();
        codes = codes.filter(c => c !== fromCode && !seenC.has(c) && (seenC.add(c), true));
        if (!codes.length) codes = ['EUR', 'GBP'];

        // Migrate a legacy single rate into the rates map.
        const rates = {};
        if (d.rates && typeof d.rates === 'object') {
            for (const k of Object.keys(d.rates)) {
                if (typeof d.rates[k] === 'number' && isFinite(d.rates[k]) && d.rates[k] > 0) rates[k.toUpperCase()] = d.rates[k];
            }
        } else if (cfg.to && typeof d.rate === 'number' && isFinite(d.rate) && d.rate > 0) {
            rates[cfg.to.toUpperCase()] = d.rate;
        }

        return {
            id: raw.id || genWidgetId(),
            type: 'currency',
            title: raw.title || 'Currency Converter',
            position: typeof raw.position === 'number' ? raw.position : 0,
            span: [1, 2, 3].includes(raw.span) ? raw.span : 1,
            config: {
                from:    fromCode,
                toCodes: codes
            },
            data: {
                rates:     rates,
                updatedAt: typeof d.updatedAt === 'number' ? d.updatedAt : null
            }
        };
    }
};

// ── T7: Habit Tracker ────────────────────────────────────────────────────
WidgetRegistry['habits'] = {
    label: 'Habit Tracker',
    emptyState: 'None yet — open Edit to add some.',
    hint: 'Track daily habits on a 7-day grid; click a cell to mark done.',
    defaults() {
        return { config: {}, data: { habits: [], log: {} } };
    },
    render: (widget, container) => root.Dashboard.renderHabits(widget, container),
    applyEdit(widget, modalBody) {
        // Persist the edited habit list. The log is managed by the widget itself and
        // untouched here. Preserve existing ids so completion log entries stay linked.
        widget.data = widget.data || {};
        const habits = [];
        modalBody.querySelectorAll('.habit-row-editor').forEach(row => {
            const labelEl = row.querySelector('.habit-label-input');
            if (!labelEl) return;
            const label = (labelEl.value || '').trim();
            if (!label) return; // skip blank rows
            const existingId = (row.getAttribute('data-habit-id') || '').trim();
            const id = existingId || ('habit-' + Date.now() + '-' + Math.random().toString(36).slice(2, 7));
            habits.push({ id, label });
        });
        // Drop log entries for habits that were removed.
        if (widget.data.log && typeof widget.data.log === 'object') {
            const keep = new Set(habits.map(h => h.id));
            for (const key of Object.keys(widget.data.log)) {
                const arr = widget.data.log[key];
                if (!Array.isArray(arr)) continue;
                widget.data.log[key] = arr.filter(id => keep.has(id));
            }
        }
        widget.data.habits = habits;
    },
    editFields(widget) {
        const d = widget.data || {};
        if (!Array.isArray(d.habits)) d.habits = [];
        const rows = d.habits.map(h => `
            <div class="habit-row-editor" data-habit-id="${root.Dashboard.escapeAttr(h.id || '')}">
                <input type="text" class="habit-label-input" value="${root.Dashboard.escapeHtml(h.label || '')}" placeholder="Habit name (e.g. Read 20 min)">
                <button type="button" class="habit-remove-entry" title="Remove habit">×</button>
            </div>
        `).join('');
        return `
            <div class="settings-group">
                <label>Habits (one per row):</label>
                <p class="hint" style="font-size:12px;opacity:0.7;margin-top:4px;">Click today's cell on the widget to mark a habit done.</p>
                <div id="habit-editor" class="habit-editor">
                    ${rows || '<p class="hint" style="font-size:12px;opacity:0.7;">No habits yet — add one below.</p>'}
                </div>
                <button type="button" id="habit-add-row" style="margin-top:8px;">+ Add Habit</button>
            </div>
        `;
    },
    sanitize(raw) {
        if (!raw || typeof raw !== 'object') return null;
        const d = (raw.data && typeof raw.data === 'object') ? raw.data : {};
        // Normalise habits array.
        let habits = Array.isArray(d.habits) ? d.habits : [];
        habits = habits
            .filter(h => h && typeof h === 'object' && typeof h.label === 'string' && h.label.trim())
            .map((h, i) => ({ id: (typeof h.id === 'string' && h.id) ? h.id : ('habit-' + Date.now() + '-' + i), label: h.label.trim().slice(0, 80) }));
        // Normalise log object.
        const log = {};
        if (d.log && typeof d.log === 'object') {
            for (const [dateKey, ids] of Object.entries(d.log)) {
                if (/^\d{4}-\d{2}-\d{2}$/.test(dateKey) && Array.isArray(ids)) {
                    log[dateKey] = ids.filter(id => typeof id === 'string');
                }
            }
        }
        return {
            id: raw.id || genWidgetId(),
            type: 'habits',
            title: raw.title || 'Habit Tracker',
            position: typeof raw.position === 'number' ? raw.position : 0,
            span: [1, 2, 3].includes(raw.span) ? raw.span : 1,
            config: (raw.config && typeof raw.config === 'object') ? raw.config : {},
            data: { habits, log }
        };
    }
};

// ── Helpers ────────────────────────────────────────────────────────────────

/** Generate a unique widget id. */
function genWidgetId() {
    return 'widget-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8);
}

/** Get the list of all registered widget types (for the add-widget modal). */
function getRegisteredTypes() {
    return Object.keys(WidgetRegistry);
}

/** Get a widget type's registry entry. Returns null if unknown. */
function getWidgetEntry(type) {
    return WidgetRegistry[type] || null;
}

// ── Registration summary (diagnostic) ────────────────────────────────────────
// P3-4: gated behind ?debug=1 so normal loads are quiet. If an earlier line in
// this file threw at runtime, the count will be low — check with ?debug=1.
if (typeof location !== 'undefined' && /[?&]debug=1(&|$)/.test(location.search)) {
    console.info('[dashboard] WidgetRegistry loaded with', Object.keys(WidgetRegistry).length,
        'entries:', Object.keys(WidgetRegistry).join(', '));
}

    // P2-9: publish the registry + its helpers on the shared namespace.
    root.Dashboard.WidgetRegistry = WidgetRegistry;
    root.Dashboard.buildSearchUrl  = buildSearchUrl;
    root.Dashboard.genWidgetId     = genWidgetId;
    root.Dashboard.getRegisteredTypes = getRegisteredTypes;
    root.Dashboard.getWidgetEntry  = getWidgetEntry;

})(typeof window !== 'undefined' ? window : globalThis);

// UMD footer (P2-9): expose the registry object for Node tests.
if (typeof module !== 'undefined' && typeof module.exports !== 'undefined') {
    module.exports = globalThis.Dashboard.WidgetRegistry;
}
