/**
 * CONVENTION — listeners vs. re-renders
 * -------------------------------------
 * Render functions must not attach click/input listeners to elements they may
 * re-render (i.e. any element recreated by an innerHTML rewrite or a later call to
 * the same render function). A listener wired once at mount is orphaned the moment
 * its element is replaced — this was the root cause of P0-1 (Pomodoro) and
 * P1-3/P1-4 (Weather/Currency Retry). Instead, either:
 *   1. update text/attributes in place on a stable skeleton (preferred for hot paths), or
 *   2. expose the action on the widget object and dispatch it from app.js's grid-level
 *      delegated click handler (handleGridClick), the pattern lists/shortcuts/search use.
 *
 * C2 — single module-level registry of active tick intervals, keyed by widget id.
 * Replaces the previous three parallel Maps (clockTimers / countdownTimers /
 * pomodoroTimers). Interval ids are unique anyway, so one Map suffices; this
 * unifies the bookkeeping while each render function keeps its own tick logic.
 *
 * Public helpers:
 *   setWidgetTimer(widgetId, intervalId) – register (replaces any existing)
 *   clearWidgetTimer(widgetId)           – clearInterval + delete for one widget
 *   clearAllWidgetTimers()               – clearInterval every entry and reset the Map
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

/**
 * C5 — shared empty-state helper.
 * Reads the `emptyState` string from the widget's registry entry (single source of truth)
 * and returns it. Falls back to a generic sentence if the entry or field is missing,
 * so new widgets that forget to set one still get consistent copy.
 */
function emptyStateText(widget) {
    const entry = typeof WidgetRegistry !== 'undefined' && widget ? WidgetRegistry[widget.type] : null;
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
 * Ask the user for a due date via prompt(). Returns an ISO "YYYY-MM-DD" string,
 * or null when cancelled / invalid. Kept dependency-free (no backend).
 */
function promptDueDate(current) {
    const toISO = (d) => d.toISOString().slice(0, 10);
    let raw;
    if (current && /^\d{4}-\d{2}-\d{2}$/.test(current)) {
        raw = window.prompt('Due date (YYYY-MM-DD):', current);
    } else {
        const today = new Date();
        raw = window.prompt('Due date (YYYY-MM-DD):', toISO(today));
    }
    if (!raw) return null;
    raw = raw.trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
        const d = new Date(raw + 'T00:00:00');
        if (!isNaN(d.getTime())) return raw;
    }
    window.alert('Please enter a date in YYYY-MM-DD format.');
    return null;
}

/**
 * Widget Component Logic
 */
function createWidgetContent(widget, container) {
    // Prefer the registry so new types need zero edits here.
    const entry = (typeof WidgetRegistry !== 'undefined') ? WidgetRegistry[widget.type] : null;

    if (entry && typeof entry.render === 'function') {
        try { entry.render(widget, container); return; } catch(e) { console.warn('registry render failed', e); }
    }

    // If we get here, either the registry entry is missing or its render threw.
    // Log a clear diagnostic so future regressions are diagnosable from DevTools
    // instead of showing only "Unknown widget type" in the card body.
    if (!entry) {
        console.error('[dashboard] WidgetRegistry has no entry for type:', JSON.stringify(widget.type),
            '| registered types:', Object.keys(WidgetRegistry || {}).join(', '));
    } else {
        console.warn('[dashboard] Registry render() threw for type:', widget.type, '(see warning above)');
    }

    // Fallback for types not yet in the registry.
    switch (widget.type) {
        case 'shortcuts':
            renderShortcuts(widget, container);
            break;
        case 'lists':
            renderLists(widget, container);
            break;
        case 'clock':
            renderClock(widget, container);
            break;
        // C3: type id renamed from 'perplexity' → 'search'. The function name
        // (renderPerplexity) is kept for continuity — it's engine-neutral in practice.
        case 'search':
            renderPerplexity(widget, container);
            break;
        default:
            container.innerHTML = `<p>Unknown widget type: ${widget.type}</p>`;
    }
}

/**
 * Shortcuts Widget
 */
function renderShortcuts(widget, container) {
    container.innerHTML = '';
    // Normalize data so add/delete handlers can safely mutate items.
    widget.data = widget.data || {};
    widget.data.items = widget.data.items || [];
    // Display order: "most used" sorts a copy by clickCount desc; manual keeps array order.
    let displayItems = widget.data.items.slice();
    if ((widget.config && widget.config.sortOrder) === 'frequent') {
        displayItems.sort((a, b) => {
            const ca = Number(a.clickCount) || 0;
            const cb = Number(b.clickCount) || 0;
            if (cb !== ca) return cb - ca;
            // Tie-breaker: alphabetical by label so the order is stable.
            return String(a.label || '').localeCompare(String(b.label || '')) || 0;
        });
    }
    // ── Toolbar: search/filter + sort order ─────────────────────────────
    const toolbar = document.createElement('div');
    toolbar.className = 'shortcut-toolbar';
    toolbar.innerHTML = `
        <input type="search" class="shortcut-filter" placeholder="Filter links…" aria-label="Filter shortcuts">
        <select class="shortcut-sort" aria-label="Sort shortcuts">
            <option value="manual">Manual order</option>
            <option value="frequent">Most used</option>
        </select>
    `;
    // Reflect the persisted sort order in the select.
    const sortOrder = (widget.config && widget.config.sortOrder) || 'manual';
    toolbar.querySelector('.shortcut-sort').value = sortOrder;

    container.appendChild(toolbar);

    // ── List of links ───────────────────────────────────────────────────
    const list = document.createElement('div');
    list.className = 'shortcuts-list';
    
    // Map each displayed item back to its real position in widget.data.items so
    // per-item actions (move / new-tab / delete) target the correct entry even when
    // "most used" sort has reordered the display.
    const items = displayItems;

    items.forEach((item, index) => {
        const realIndex = widget.data.items.indexOf(item);
        const div = document.createElement('div');
        div.className = 'shortcut-item-container';

        // Favicon: auto-fetched from Google's s2 endpoint (no backend needed).
        let faviconHtml = '';
        if (item.icon && /^https?:\/\//.test(item.icon)) {
            faviconHtml = `<img class="shortcut-icon" src="${escapeAttr(item.icon)}" alt="" width="18" height="18">`;
        } else {
            const domain = safeDomainForFavicon(item.url);
            if (domain) {
                faviconHtml = `<span class="shortcut-favicon-wrap"><img class="shortcut-icon shortcut-favicon" src="${escapeAttr(`https://www.google.com/s2/favicons?domain=${encodeURIComponent(domain)}&sz=64`)}" alt="" width="18" height="18" loading="lazy" data-domain="${escapeAttr(domain)}"><span class="shortcut-icon-fallback">${escapeHtml((item.label || '?').trim().charAt(0).toUpperCase())}</span></span>`;
            } else {
                faviconHtml = `<span class="shortcut-icon shortcut-letter-avatar">${escapeHtml((item.label || '?').trim().charAt(0).toUpperCase())}</span>`;
            }
        }

        const a = document.createElement('a');
        a.className = 'shortcut-item';
        a.href = item.url;
        a.target = item.openInNewTab ? '_blank' : '_self';
        if (item.openInNewTab) a.rel = 'noopener noreferrer';
        a.innerHTML = `
            ${faviconHtml}
            <span class="shortcut-label">${escapeHtml(item.label)}</span>
            <small class="shortcut-desc" style="opacity: 0.6; margin-left: auto; display: block;">${escapeHtml(item.description || '')}</small>
        `;

        // Per-item control: remove this link. (Links open in a new tab by default;
        // the up/down reorder arrows and per-row new-tab toggle were removed on request.)
        const deleteBtn = document.createElement('button');
        deleteBtn.type = 'button';
        deleteBtn.className = 'delete-shortcut-btn';
        deleteBtn.innerText = '×';
        deleteBtn.title = `Remove ${item.label}`;
        deleteBtn.dataset.index = realIndex;

        div.appendChild(a);
        const controlsRow = document.createElement('div');
        controlsRow.className = 'shortcut-item-controls';
        controlsRow.appendChild(deleteBtn);
        div.appendChild(controlsRow);

        // Track clicks for "most used" ordering (increment on navigation).
        a.addEventListener('click', () => {
            if (!item.clickCount) item.clickCount = 0;
            item.clickCount += 1;
            saveFullState();
        });

        list.appendChild(div);
    });

    // NOTE: the "+ Add link" form now lives on this widget's Edit page (see
    // WidgetRegistry['shortcuts'].editFields + #shortcut-add-link in app.js), so it is
    // intentionally NOT rendered inside the card body anymore.
    container.appendChild(list);
}

/**
 * Lists Widget
 */
function renderLists(widget, container) {
    // Clear any previous render so re-renders don't stack duplicate DOM.
    container.innerHTML = '';

    const items = widget.data.items || [];
    const showCompleted = widget.data.showCompleted ?? true;
    let visible = showCompleted ? items.slice() : items.filter(i => !i.completed).slice();

    // Optional: sort by due date (nulls last), then text. Only when the user toggles it on.
    if (widget.data.sortByDueDate) {
        visible.sort((a, b) => {
            const ad = a.dueDate ? new Date(a.dueDate).getTime() : Infinity;
            const bd = b.dueDate ? new Date(b.dueDate).getTime() : Infinity;
            if (ad !== bd) return ad - bd;
            return String(a.text || '').localeCompare(String(b.text || ''));
        });
    }

    // "Today" in local time, at midnight — used to flag overdue items.
    const todayMidnight = new Date();
    todayMidnight.setHours(0, 0, 0, 0);

    const total = items.length;
    const completed = items.filter(i => i.completed).length;
    const remaining = total - completed;

    const stats = document.createElement('div');
    stats.className = 'list-stats';
    stats.style.fontSize = '12px';
    stats.style.marginBottom = '10px';
    stats.innerText = `Remaining: ${remaining} | Completed: ${completed}`;

    container.appendChild(stats);

    // NOTE: the "Show completed", "Sort by due date" and "Clear completed"
    // controls now live on this widget's Edit page (see WidgetRegistry['lists'].editFields).
    // They are intentionally NOT rendered in the card body anymore.

    // Semantic <ul>/<li> list
    const list = document.createElement('ul');
    list.className = 'lists-container';
    list.setAttribute('role', 'list');

    visible.forEach((item, visibleIndex) => {
        const realIndex = items.indexOf(item);

        // Overdue: has a due date in the past and is not yet completed.
        let overdue = false;
        if (item.dueDate && !item.completed) {
            const d = new Date(item.dueDate);
            if (!isNaN(d.getTime()) && d < todayMidnight) overdue = true;
        }

        const li = document.createElement('li');
        li.className = 'list-item' + (item.completed ? ' completed' : '') + (overdue ? ' overdue' : '');
        // The whole row is a click target that opens the inline editor for due date + note.
        // NOTE: intentionally NOT role="button" / tabindex — this <li> also contains real
        // interactive controls (checkbox + delete). A button role wrapping other interactives
        // confuses screen readers. Click-to-open still works via the delegated handler in app.js;
        // keyboard users reach the checkbox/delete directly, and can open the editor by clicking.
        li.dataset.index = realIndex;
        li.title = 'Click to set due date and add/edit note';

        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.className = 'list-item-checkbox';
        checkbox.checked = !!item.completed;
        checkbox.dataset.index = realIndex;
        checkbox.setAttribute('aria-label', `Mark \"${item.text}\" as ${item.completed ? 'not completed' : 'completed'}`);

        const labelWrap = document.createElement('span');
        labelWrap.className = 'list-item-label';
        labelWrap.appendChild(checkbox);
        const span = document.createElement('span');
        span.className = 'list-item-text';
        span.textContent = item.text;
        labelWrap.appendChild(span);

        // Compact due-date chip (informational; the row click opens the editor).
        if (item.dueDate) {
            const dLabel = new Date(item.dueDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
            const dueChip = document.createElement('span');
            dueChip.className = 'list-due-chip list-due-chip-static' + (overdue ? ' overdue' : '');
            dueChip.textContent = (overdue ? '⚠ ' : '') + dLabel;
            li.appendChild(dueChip);
        }

        // Inline note preview when present.
        if (item.note) {
            const noteSpan = document.createElement('span');
            noteSpan.className = 'list-note-inline';
            noteSpan.title = item.note;
            noteSpan.textContent = truncate(item.note, 24);
            li.appendChild(noteSpan);
        }

        // Delete button — the only per-item control remaining in-card.
        const deleteBtn = document.createElement('button');
        deleteBtn.type = 'button';
        deleteBtn.className = 'delete-list-btn';
        deleteBtn.dataset.index = realIndex;
        deleteBtn.textContent = '×';
        deleteBtn.title = `Delete \"${item.text}\"`;
        deleteBtn.setAttribute('aria-label', `Delete \"${item.text}\"`);

        li.appendChild(labelWrap);
        li.appendChild(deleteBtn);

        // Inline editor for due date + note. Hidden by default; toggled open when the row is clicked.
        const editor = document.createElement('div');
        editor.className = 'list-item-editor';
        editor.dataset.index = realIndex;
        editor.hidden = true;

        const dueInputWrap = document.createElement('label');
        dueInputWrap.className = 'list-edit-field';
        dueInputWrap.innerHTML = '<span>Due date</span>' +
            `<input type="date" class="list-due-input" value="${escapeAttr((item.dueDate && /^\d{4}-\d{2}-\d{2}$/.test(item.dueDate)) ? item.dueDate : '')}">`;

        const noteWrap = document.createElement('label');
        noteWrap.className = 'list-edit-field';
        noteWrap.innerHTML = '<span>Note</span>' +
            `<textarea class="list-note-input" placeholder="Add a note…">${escapeHtml(item.note || '')}</textarea>`;

        const actionsRow = document.createElement('div');
        actionsRow.className = 'list-edit-actions';
        actionsRow.innerHTML = `
            <button type="button" class="list-editor-save">Save</button>
            <button type="button" class="list-editor-cancel">Cancel</button>
        `;

        editor.appendChild(dueInputWrap);
        editor.appendChild(noteWrap);
        editor.appendChild(actionsRow);
        li.appendChild(editor);

        list.appendChild(li);
    });

    if (visible.length === 0) {
        const empty = document.createElement('li');
        empty.className = 'list-empty';
        empty.textContent = showCompleted ? 'No items yet.' : 'No remaining items — all done!';
        list.appendChild(empty);
    }

    const inputArea = document.createElement('div');
    inputArea.className = 'list-input-area';
    inputArea.innerHTML = `
        <input type="text" placeholder="New item..." class="list-input">
        <button class="add-list-btn">Add</button>
    `;

    container.appendChild(list);
    container.appendChild(inputArea);
}

/**
 * World Clock Widget
 * A single widget that displays multiple times.
 * Each entry has its own label and timezone.
 */
function renderClock(widget, container) {
    const config = widget.config || {};
    config.showSeconds = config.showSeconds ?? false;
    config.showDate = config.showDate ?? true;
    widget.data = widget.data || {};
    widget.data.times = widget.data.times || [];

    container.innerHTML = '';

    // Capture "now" once for the initial badge render; tick() refreshes it each second.
    let now = new Date();

    const list = document.createElement('div');
    list.className = 'clock-list';

    widget.data.times.forEach((entry, index) => {
        const row = document.createElement('div');
        row.className = 'clock-row';

        const info = document.createElement('div');
        info.className = 'clock-info';

        // Day-offset badge: compare this timezone's current calendar day to local today.
        const offsetBadge = clockDayOffset(entry.timezone, now);

        const labelWrap = document.createElement('div');
        labelWrap.className = 'clock-label-wrap';

        const label = document.createElement('span');
        label.className = 'clock-label';
        label.textContent = entry.label || entry.timezone;
        labelWrap.appendChild(label);

        if (offsetBadge) {
            const badge = document.createElement('span');
            badge.className = 'clock-day-badge' + (offsetBadge.tone ? ` ${offsetBadge.tone}` : '');
            badge.textContent = offsetBadge.text;
            badge.title = `${entry.label || entry.timezone} is on a different calendar day than your local time.`;
            labelWrap.appendChild(badge);
        }

        // Date (left) and time (right), each its own element so they can align independently.
        const dateEl = document.createElement('span');
        dateEl.className = 'clock-date';
        dateEl.dataset.index = index;

        const timeEl = document.createElement('span');
        timeEl.className = 'clock-time';
        timeEl.dataset.index = index;
        timeEl.setAttribute('aria-live', 'polite');
        timeEl.setAttribute('role', 'timer');

        // Location name on top; date left, time right below it.
        info.appendChild(labelWrap);
        const dtRow = document.createElement('div');
        dtRow.className = 'clock-dt';
        if (config.showDate) {
            dtRow.appendChild(dateEl);
        } else {
            // No date: give the time a flex-basis so it still sits on its own line.
            dtRow.style.justifyContent = 'flex-start';
        }
        dtRow.appendChild(timeEl);
        info.appendChild(dtRow);

        // No per-row delete button: add/remove times is managed on the Edit page.
        row.appendChild(info);
        list.appendChild(row);
    });

    if (widget.data.times.length === 0) {
        const empty = document.createElement('div');
        empty.className = 'clock-empty';
        // C5: shared copy from registry metadata.
        empty.textContent = emptyStateText(widget);
        list.appendChild(empty);
    }

    container.appendChild(list);

    // Refresh the day-offset badges (cheap; only recompute when the local date string changes).
    function refreshBadges() {
        list.querySelectorAll('.clock-row').forEach(row => {
            const idx = Number(row.querySelector('.clock-time')?.dataset.index);
            const entry = widget.data.times[idx];
            if (!entry) return;
            const labelWrap = row.querySelector('.clock-label-wrap');
            if (!labelWrap) return;
            let badge = labelWrap.querySelector('.clock-day-badge');
            const offset = clockDayOffset(entry.timezone, now);
            if (offset) {
                if (!badge) {
                    badge = document.createElement('span');
                    badge.className = 'clock-day-badge';
                    labelWrap.appendChild(badge);
                }
                badge.textContent = offset.text;
                badge.className = 'clock-day-badge' + (offset.tone ? ` ${offset.tone}` : '');
            } else if (badge) {
                badge.remove();
            }
        });
    }

    const tick = () => {
        now = new Date();
        const hour12 = config.formatType === 12;

        widget.data.times.forEach((entry, index) => {
            // Find this clock's time element (each has a unique data-index).
            const timeEl = list.querySelector(`.clock-time[data-index="${index}"]`);
            if (!timeEl) return;
            const dateEl = list.querySelector(`.clock-date[data-index="${index}"]`);

            // Time-only options (hour/minute[/second]); no calendar parts.
            const timeOptions = {
                timeZone: entry.timezone,
                hour: 'numeric',
                minute: '2-digit',
                hour12
            };
            if (config.showSeconds) timeOptions.second = '2-digit';

            // Date-only options, used when showDate is on.
            const dateOptions = {
                timeZone: entry.timezone,
                weekday: 'short',
                month: 'short',
                day: 'numeric'
            };

            try {
                timeEl.textContent = new Intl.DateTimeFormat('en-US', timeOptions).format(now);
                if (dateEl) dateEl.textContent = new Intl.DateTimeFormat('en-US', dateOptions).format(now);
            } catch (e) {
                timeEl.textContent = 'Invalid timezone';
                if (dateEl) dateEl.textContent = '';
            }
        });

        // Keep day-offset badges in sync as the clock crosses midnight locally.
        refreshBadges();
    };

    tick();

    // C2: register the interval in the shared widget-timer registry so re-renders
    // and removal can clear it (fixes the timer leak).
    clearWidgetTimer(widget.id);
    setWidgetTimer(widget.id, setInterval(tick, 1000));
}

/**
 * Compute how this timezone's current calendar day relates to local today.
 * Returns { text, tone } e.g. "Yesterday"/"Today"/"Tomorrow", or null if it can't be determined.
 */
function clockDayOffset(timezone, now) {
    const fmt = (tz) => new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(now); // YYYY-MM-DD
    let localDate, zoneDate;
    try {
        localDate = fmt(undefined);
        zoneDate  = fmt(timezone);
    } catch (e) {
        return null; // invalid timezone → no badge
    }
    if (!localDate || !zoneDate || localDate === zoneDate) return null;
    const diffDays = Math.round((new Date(zoneDate + 'T00:00:00') - new Date(localDate + 'T00:00:00')) / 86400000);
    if (diffDays === 1)  return { text: 'Tomorrow', tone: 'tomorrow' };
    if (diffDays === -1) return { text: 'Yesterday', tone: 'yesterday' };
    if (diffDays > 1)   return { text: `+${diffDays}d`, tone: 'other' };
    if (diffDays < -1)  return { text: `${diffDays}d`, tone: 'other' };
    return null;
}

/** C2: thin alias over the shared registry — kept so existing call-sites read naturally. */
function clearClockTimer(widgetId) { return clearWidgetTimer(widgetId); }

/**
 * Weather Widget (Open-Meteo, keyless)
 *
 * Data: { lat, lon, city }
 * Config: { units: 'metric' | 'imperial', showForecast: boolean }
 *
 * Uses the free Open-Meteo API. When no coordinates are set it falls back to
 * browser geolocation (with a graceful message if denied).
 */
function renderWeather(widget, container) {
    widget.data = widget.data || {};
    const cfg = widget.config || {};
    const units = cfg.units === 'imperial' ? 'imperial' : 'metric';

    // State for this card instance (not persisted; refreshed on each render).
    let currentData = null;
    let forecastData = null;
    let hourlyData = null;   // T4: next-hours strip
    let lastError = '';      // error message shown in the retry box when fetch fails
    let loading = false;

    const body = document.createElement('div');
    body.className = 'weather-body';
    container.appendChild(body);

    function setLoading(msg) {
        loading = true;
        currentData = null;
        forecastData = null;
        lastError = '';
        renderBody();
        if (msg) body.dataset.status = 'loading';
    }

    function setError(err) {
        loading = false;
        lastError = err || 'Could not load weather.';
        renderBody();
        if (typeof announceStatus === 'function') announceStatus('Weather failed to load: ' + lastError);
    }

    async function fetchWeather(lat, lon) {
        const params = new URLSearchParams({
            latitude: String(lat),
            longitude: String(lon),
            current_weather: 'true',
            timezone: 'auto'
        });
        // T4: request humidity + UV index for the meta row.
        if (cfg.showHumidity !== false) {
            params.set('current', 'relative_humidity_2m,uv_index');
        }
        if (cfg.showForecast !== false) {
            params.set('daily', 'weather_code,temperature_2m_max,temperature_2m_min');
            params.set('forecast_days', '5');
            // T4: next-hours strip — temperature + precip chance for the coming hours.
            if (cfg.showHourly !== false) {
                params.set('hourly', 'temperature_2m,precipitation_probability,weather_code');
            }
        }
        const url = `https://api.open-meteo.com/v1/forecast?${params.toString()}`;

        loading = true;
        renderBody();

        try {
            const res = await fetch(url, { mode: 'cors' });
            if (!res.ok) throw new Error('HTTP ' + res.status);
            const json = await res.json();
            currentData = json.current_weather || null;
            // T4: merge the `current` block (humidity, UV) into currentData so renderBody
            // can read them alongside temperature/wind. Guard each field — some API
            // responses may omit it.
            if (json.current && typeof json.current === 'object') {
                currentData = Object.assign({}, currentData || {}, json.current);
            }
            forecastData = json.daily || null;
            hourlyData = (cfg.showHourly !== false) ? (json.hourly || null) : null;
            lastError = '';
        } catch (e) {
            console.warn('weather fetch failed', e);
            loading = false;
            setError(e.message || 'Network error');
            return;
        }

        // Cache the latest price-style fields on the widget so a re-render can show them.
        if (currentData && typeof currentData.temperature === 'number') {
            widget.data.lastTemperature = currentData.temperature;
            widget.data.lastFetchedAt = Date.now();
        }

        loading = false;
        renderBody();
        // Announce the update to screen readers via the global live region.
        if (typeof announceStatus === 'function') {
            const t = currentData && typeof currentData.temperature === 'number' ? Math.round(currentData.temperature) + '°' : '';
            // NOTE: compute the label here — `cityLabel` is scoped inside renderBody() and
            // would be a ReferenceError if referenced from this outer function.
            const city = (widget.data && widget.data.city) || 'Your Location';
            announceStatus('Weather updated for ' + city + (t ? ', currently ' + t : '') + '.');
        }
    }

    function weatherCodeToText(code) {
        const map = {
            0: 'Clear sky', 1: 'Mainly clear', 2: 'Partly cloudy', 3: 'Overcast',
            45: 'Fog', 48: 'Depositing rime fog',
            51: 'Light drizzle', 53: 'Moderate drizzle', 55: 'Dense drizzle',
            61: 'Slight rain', 63: 'Moderate rain', 65: 'Heavy rain',
            71: 'Slight snow', 73: 'Moderate snow', 75: 'Heavy snowfall',
            80: 'Slight rain showers', 81: 'Moderate rain showers', 82: 'Violent rain showers',
            95: 'Thunderstorm'
        };
        return map[code] || '';
    }

    function weatherCodeToEmoji(code) {
        const map = {
            0: '☀️', 1: '🌤️', 2: '⛅', 3: '☁️',
            45: '🌫️', 48: '🌫️',
            51: '🌦️', 53: '🌧️', 55: '🌧️',
            61: '🌦️', 63: '🌧️', 65: '⛈️',
            71: '🌨️', 73: '❄️', 75: '❄️',
            80: '🌦️', 81: '🌧️', 82: '⛈️',
            95: '⛈️'
        };
        return map[code] || '🌡️';
    }

    function formatTemp(t) {
        if (t == null || isNaN(t)) return '--°';
        const unit = units === 'imperial' ? 'F' : 'C';
        // Open-Meteo returns metric by default; convert for imperial.
        let value = t;
        if (units === 'imperial') {
            value = t * 9 / 5 + 32;
        }
        return `${Math.round(value)}°${unit}`;
    }

    function renderBody() {
        body.innerHTML = '';

        const cityLabel = widget.data.city || 'Your Location';

        if (loading) {
            const p = document.createElement('p');
            p.className = 'weather-status';
            p.textContent = `Loading weather for ${cityLabel}…`;
            body.appendChild(p);
            return;
        }

        if (lastError) {
            const errBox = document.createElement('div');
            errBox.className = 'weather-error';
            errBox.innerHTML = `
                <p>⚠️ ${escapeHtml(lastError)}</p>
                <button type="button" class="weather-retry-btn">Retry</button>
            `;
            body.appendChild(errBox);
            return;
        }

        if (!currentData) {
            const empty = document.createElement('div');
            empty.className = 'weather-empty';
            empty.innerHTML = `
                <p>No coordinates set yet.</p>
                <button type="button" class="weather-locate-btn">📍 Use my location</button>
                <p style="font-size:12px;opacity:0.7;margin-top:8px;">Or open Edit to enter a city's lat/lon manually.</p>
            `;
            body.appendChild(empty);
            return;
        }

        const main = document.createElement('div');
        main.className = 'weather-main';
        const code = currentData.weather_code || 0;
        main.innerHTML = `
            <div class="weather-icon">${weatherCodeToEmoji(code)}</div>
            <div class="weather-temp">${formatTemp(currentData.temperature)}</div>
            <div class="weather-desc">${escapeHtml(weatherCodeToText(code))}</div>
            <div class="weather-meta">
                ${cfg.showHumidity !== false && currentData.relative_humidity_2m != null ? `<span>💧 ${Math.round(currentData.relative_humidity_2m)}%</span>` : ''}
                ${cfg.showHumidity !== false && currentData.uv_index != null ? `<span>🔆 UV ${currentData.uv_index}</span>` : ''}
                ${currentData.windspeed != null ? `<span>💨 ${Math.round(units === 'imperial' ? currentData.windspeed * 2.23694 : currentData.windspeed)} ${units === 'imperial' ? 'mph' : 'km/h'}</span>` : ''}
                ${currentData.winddirection != null ? `<span>🧭 ${Math.round(currentData.winddirection)}°</span>` : ''}
            </div>
        `;
        body.appendChild(main);

        // T4: compact next-hours strip. Find the current hour index in hourly.time
        // and show the following N hours.
        if (cfg.showHourly !== false &&
            hourlyData && Array.isArray(hourlyData.time) && hourlyData.time.length > 1 &&
            Array.isArray(hourlyData.temperature_2m)) {
            const now = new Date();
            // Build a comparable key (local time, hour precision).
            // NOTE: Open-Meteo returns hourly.time in the API-resolved location's
            // timezone (timezone=auto). This match is correct when the viewer's
            // browser TZ equals that resolved TZ. If a user travels to a different
            // timezone while viewing a saved city, the "current hour" highlight may
            // be off by the offset — acceptable for this app's local-first use case.
            const nowKey = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}T${String(now.getHours()).padStart(2,'0')}:00`;
            let startIdx = hourlyData.time.findIndex(t => t === nowKey);
            if (startIdx < 0) {
                // Fallback: first entry at or after current time, else index 1.
                startIdx = hourlyData.time.findIndex(t => new Date(t) >= now);
                if (startIdx < 0) startIdx = 1;
            }
            // Show up to the next 8 hours, skipping "now" itself.
            const count = Math.min(8, hourlyData.time.length - startIdx - 1);
            if (count > 0) {
                const strip = document.createElement('div');
                strip.className = 'weather-hourly';
                for (let i = 0; i < count; i++) {
                    const idx = startIdx + 1 + i;
                    const hLabel = new Date(hourlyData.time[idx]).toLocaleTimeString('en-US', { hour: 'numeric' });
                    const hTemp = formatTemp(hourlyData.temperature_2m ? hourlyData.temperature_2m[idx] : null);
                    const hCode = (hourlyData.weather_code && hourlyData.weather_code[idx]) || 0;
                    let precipHtml = '';
                    if (hourlyData.precipitation_probability != null && hourlyData.precipitation_probability[idx] != null) {
                        const p = Math.round(hourlyData.precipitation_probability[idx]);
                        if (p > 0) precipHtml = `<span class="h-precip">💧${p}%</span>`;
                    }
                    strip.insertAdjacentHTML('beforeend', `
                        <div class="weather-hour">
                            <span class="h-label">${escapeHtml(hLabel)}</span>
                            <span class="h-icon" title="${escapeHtml(weatherCodeToText(hCode))}">${weatherCodeToEmoji(hCode)}</span>
                            <span class="h-temp">${hTemp}</span>
                            ${precipHtml}
                        </div>
                    `);
                }
                body.appendChild(strip);
            }
        }

        if (cfg.showForecast !== false && forecastData && Array.isArray(forecastData.time) && forecastData.time.length > 1) {
            const fc = document.createElement('div');
            fc.className = 'weather-forecast';
            const days = Math.min(5, forecastData.time.length - 1);
            for (let i = 1; i <= days; i++) {
                const dayLabel = new Date(forecastData.time[i]).toLocaleDateString('en-US', { weekday: 'short' });
                const hi = formatTemp(forecastData.temperature_2m_max ? forecastData.temperature_2m_max[i] : null);
                const lo = formatTemp(forecastData.temperature_2m_min ? forecastData.temperature_2m_min[i] : null);
                const dayCode = (forecastData.weather_code && forecastData.weather_code[i]) || 0;
                fc.insertAdjacentHTML('beforeend', `
                    <div class="weather-fc-day">
                        <span class="fc-label">${escapeHtml(dayLabel)}</span>
                        <span class="fc-icon">${weatherCodeToEmoji(dayCode)}</span>
                        <span class="fc-range">${lo} / ${hi}</span>
                    </div>
                `);
            }
            body.appendChild(fc);
        }

        // T12: "Use my location" and "Refresh" buttons moved to the card header.
        // The locate button remains only in the empty-state above (when no coords set).
        // Refresh is triggered via the ↻ icon next to the gear (app.js handleWidgetAction).
    }

    // Button actions.
    // Convention: render functions must not attach listeners to elements they may
    // re-render (the error/empty states are rebuilt by renderBody() after wiring ran,
    // which orphaned the listeners — P1-3). Instead we expose locate/refresh on the
    // widget and let app.js's grid-level delegated click handler dispatch them, the
    // same pattern lists/shortcuts/search already use.
    const locate = () => {
        if (!navigator.geolocation) {
            setError('Geolocation is not supported by this browser.');
            return;
        }
        setLoading();
        navigator.geolocation.getCurrentPosition(
            (pos) => {
                widget.data.lat = pos.coords.latitude;
                widget.data.lon = pos.coords.longitude;
                if (!widget.data.city || widget.data.city === 'Your Location') {
                    // Reverse-geocode via Open-Meteo's free endpoint is not available; keep the label.
                }
                saveFullState();
                fetchWeather(widget.data.lat, widget.data.lon);
            },
            (err) => setError('Location denied: ' + err.message),
            { timeout: 10000 }
        );
    };

    const refresh = () => {
        if (widget.data.lat == null || widget.data.lon == null) {
            locate();
            return;
        }
        fetchWeather(widget.data.lat, widget.data.lon);
    };

    // T12: .weather-refresh-btn no longer exists in the body (moved to header).
    // Expose locate + refresh on the widget so app.js's header ↻ icon and the
    // in-card Retry / "Use my location" buttons (via grid delegation) can call them.
    widget.__weatherLocate = locate;
    widget.__weatherRefresh = refresh;

    renderBody();

    // Auto-fetch if we already have coordinates.
    if (widget.data.lat != null && widget.data.lon != null) {
        fetchWeather(widget.data.lat, widget.data.lon);
    }
}

/**
 * Notes / Scratchpad Widget
 *
 * Data: { text, updatedAt }
 */
function renderNotes(widget, container) {
    widget.data = widget.data || {};
    const ta = document.createElement('textarea');
    ta.className = 'notes-textarea';
    ta.placeholder = 'Jot something down… (autosaves as you type)';
    ta.value = widget.data.text || '';

    let saveTimer = null;
    function scheduleSave() {
        if (saveTimer) clearTimeout(saveTimer);
        saveTimer = setTimeout(() => {
            widget.data.text = ta.value;
            widget.data.updatedAt = Date.now();
            saveFullState();
            updateTimestamp();
        }, 300);
    }

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
        saveFullState();
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
function getTwelveDataKey() {
    try { return ((typeof state !== 'undefined' && state.settings) || {}).twelvedataApiKey || ''; } catch (e) { return ''; }
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
            // C5: shared copy from registry metadata.
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
            if (typeof state !== 'undefined' && state.settings && typeof state.settings.stockLinkTemplate === 'string' && state.settings.stockLinkTemplate.includes('{ticker}')) {
                const url = state.settings.stockLinkTemplate.replace('{ticker}', encodeURIComponent(s.symbol));
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
        // Each symbol gets a quote + time_series request; the two run in parallel
        // within each chunk to stay under Twelve Data's free-tier rate limit.
        const CHUNK = 4;
        let failures = 0;

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
            }));
        }

        // Stamp the cache so we know how fresh it is. Only update when at least one
        // ticker succeeded — a total failure leaves any prior timestamp intact.
        if (failures < symbols.length) widget.data.updatedAt = Date.now();

        saveFullState();
        renderList();
        if (failures === symbols.length && key) {
            setStatus('<p class="stock-status-err">Could not load live quotes (check the API key / rate limit). Showing cached prices.</p>');
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
function renderCountdown(widget, container) {
    widget.data = widget.data || {};
    if (!Array.isArray(widget.data.events)) widget.data.events = [];

    const listEl = document.createElement('div');
    listEl.className = 'countdown-list';
    container.appendChild(listEl);

    function fmtRemaining(ms) {
        if (ms < 0) ms = 0;
        const totalSec = Math.floor(ms / 1000);
        const d = Math.floor(totalSec / 86400);
        const h = Math.floor((totalSec % 86400) / 3600);
        const m = Math.floor((totalSec % 3600) / 60);
        const s = totalSec % 60;
        if (d > 0) return `${d}d ${h}h ${m}m`;
        if (h > 0) return `${h}h ${m}m ${s}s`;
        if (m > 0) return `${m}m ${s}s`;
        return `${s}s`;
    }

    function renderList() {
        listEl.innerHTML = '';
        const events = widget.data.events.slice().sort((a, b) => new Date(a.when) - new Date(b.when));
        if (events.length === 0) {
            // C5: shared copy from registry metadata.
            listEl.innerHTML = `<p class="countdown-empty">${escapeHtml(emptyStateText(widget))}</p>`;
            return;
        }
        const now = Date.now();
        events.forEach(ev => {
            const whenMs = new Date(ev.when).getTime();
            if (isNaN(whenMs)) return;
            const diff = whenMs - now;
            const past = diff < 0;

            const row = document.createElement('div');
            row.className = 'countdown-row' + (past ? ' past' : '');

            const labelEl = document.createElement('span');
            labelEl.className = 'countdown-label';
            labelEl.textContent = ev.label || new Date(whenMs).toLocaleDateString();

            const valueEl = document.createElement('span');
            // Right-justified so the d/h/m/s blocks line up at the right edge;
            // white text instead of the accent blue (see .countdown-value.future).
            valueEl.className = 'countdown-value' + (past ? '' : ' future');
            if (past) {
                // Parentheses so the ternary binds to `diff < 60000`, not the string concat.
                valueEl.textContent = (Math.abs(diff) > 60000)
                    ? fmtRemaining(Math.abs(diff)) + ' ago'
                    : 'Just now';
            } else {
                valueEl.textContent = fmtRemaining(diff);
            }

            const dateEl = document.createElement('small');
            dateEl.className = 'countdown-date';
            dateEl.textContent = new Date(whenMs).toLocaleString();

            row.appendChild(labelEl);
            row.appendChild(valueEl);
            row.appendChild(dateEl);
            listEl.appendChild(row);
        });
    }

    function tick() { renderList(); }

    // C2: clear any previous interval for this widget so re-renders don't stack timers.
    clearWidgetTimer(widget.id);
    tick();
    setWidgetTimer(widget.id, setInterval(tick, 1000));
}

/** C2: thin alias over the shared registry — kept so existing call-sites read naturally. */
function clearCountdownTimer(widgetId) { return clearWidgetTimer(widgetId); }

/**
 * RSS / News Widget — reads one or more feeds and shows the latest items.
 *
 * Data: { feeds: [{ label, url, maxItems }] }
 *
 * Fetches each feed directly. Many public feeds block cross-origin requests;
 * when that happens we show a per-feed error instead of failing silently. A
 * "via AllOrigins" proxy is attempted as a fallback so more feeds work.
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
            if (window.state && window.state.settings) {
                userProxy = String(window.state.settings.corsProxyUrl || '').trim();
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
function renderPomodoro(widget, container) {
    widget.data = widget.data || {};
    const cfg = widget.config || {};
    const focusMin   = Math.max(1,  Number(cfg.focusMin)        || 25);
    const shortBrkMin= Math.max(1,  Number(cfg.shortBreakMin)   || 5);
    const longBrkMin = Math.max(1,  Number(cfg.longBreakMin)    || 15);
    const sessionsUntilLong = Math.max(2, Number(cfg.sessionsUntilLong) || 4);

    // Normalise runtime state.
    if (!['focus','short','long'].includes(widget.data.mode)) widget.data.mode = 'focus';
    if (typeof widget.data.remainingSec !== 'number' || !isFinite(widget.data.remainingSec) || widget.data.remainingSec < 0) {
        widget.data.remainingSec = focusMin * 60;
    }
    if (typeof widget.data.completedSessions !== 'number') widget.data.completedSessions = 0;

    container.innerHTML = '';

    const wrap = document.createElement('div');
    wrap.className = 'pomodoro-wrap';

    // Static skeleton: build the DOM once and update only textContent / style.width
    // per tick. Rebuilding innerHTML on every render would destroy the buttons and
    // orphan their listeners (P0-1). The mode label, time, progress fill and session
    // count are computed per render because widget.data.mode changes when a session
    // completes — but the elements themselves are created exactly once here.
    const modeEl = document.createElement('div');
    modeEl.className = 'pomodoro-mode';

    const timeEl = document.createElement('div');
    timeEl.className = 'pomodoro-time';

    const progressEl = document.createElement('div');
    progressEl.className = 'pomodoro-progress';
    const barEl = document.createElement('div');
    barEl.className = 'pomodoro-bar';
    progressEl.appendChild(barEl);

    const sessionsEl = document.createElement('p');
    sessionsEl.className = 'pomodoro-sessions';

    const actionsEl = document.createElement('div');
    actionsEl.className = 'pomodoro-actions';
    const startPauseBtn = document.createElement('button');
    startPauseBtn.type = 'button';
    startPauseBtn.className = 'pomodoro-btn pomodoro-start-pause';
    const resetBtn = document.createElement('button');
    resetBtn.type = 'button';
    resetBtn.className = 'pomodoro-btn pomodoro-reset';
    resetBtn.textContent = '↺ Reset';
    actionsEl.appendChild(startPauseBtn);
    actionsEl.appendChild(resetBtn);

    wrap.appendChild(modeEl);
    wrap.appendChild(timeEl);
    wrap.appendChild(progressEl);
    wrap.appendChild(sessionsEl);
    wrap.appendChild(actionsEl);

    function fmt(sec) {
        sec = Math.max(0, Math.round(sec));
        const m = Math.floor(sec / 60);
        const s = sec % 60;
        return `${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;
    }

    // Update the existing skeleton in place — never rebuild it.
    function renderState() {
        modeEl.textContent = { focus: 'Focus', short: 'Short Break', long: 'Long Break' }[widget.data.mode] || 'Focus';
        timeEl.textContent = fmt(widget.data.remainingSec);

        const totalSec  = (widget.data.mode === 'focus' ? focusMin : widget.data.mode === 'short' ? shortBrkMin : longBrkMin) * 60;
        barEl.style.width = Math.max(0, Math.min(100, (widget.data.remainingSec / totalSec) * 100)).toFixed(1) + '%';

        sessionsEl.textContent = `✓ ${widget.data.completedSessions} session${widget.data.completedSessions === 1 ? '' : 's'} completed`;
        startPauseBtn.textContent = widget.data.running ? '⏸ Pause' : '▶ Start';
    }

    renderState();
    container.appendChild(wrap);

    // ── Timer management ───────────────────────────────────────────────
    function clearTimer() { return clearWidgetTimer(widget.id); }

    function startTick() {
        clearTimer(); // prevent stacking on re-render / double-start
        widget.data.running = true;
        renderState();
        const id = setInterval(() => {
            if (widget.data.remainingSec > 0) {
                widget.data.remainingSec--;
            }
            if (widget.data.remainingSec <= 0) {
                // Session finished.
                clearTimer();
                widget.data.running = false;

                if (widget.data.mode === 'focus') {
                    widget.data.completedSessions++;
                    const shouldLong = (widget.data.completedSessions % sessionsUntilLong === 0);
                    widget.data.mode = shouldLong ? 'long' : 'short';
                } else {
                    // Break finished → back to focus.
                    widget.data.mode = 'focus';
                }

                const nextMin = (widget.data.mode === 'focus') ? focusMin
                               : (widget.data.mode === 'short') ? shortBrkMin : longBrkMin;
                widget.data.remainingSec = nextMin * 60;

                // Visual + audio cue.
                if (typeof announceStatus === 'function') {
                    const label = { focus: 'Focus', short: 'Short Break', long: 'Long Break' }[widget.data.mode];
                    announceStatus('Pomodoro complete — starting ' + label.toLowerCase() + '.');
                }
            }
            renderState();
        }, 1000);
        setWidgetTimer(widget.id, id);
    }

    function pauseTick() {
        clearTimer();
        widget.data.running = false;
        renderState();
    }

    // ── Button wiring (the skeleton is built once, so these listeners stay valid) ──
    startPauseBtn.addEventListener('click', () => {
        if (widget.data.running) pauseTick(); else startTick();
    });

    resetBtn.addEventListener('click', () => {
        clearTimer();
        widget.data.running = false;
        widget.data.mode = 'focus';
        widget.data.remainingSec = focusMin * 60;
        renderState();
    });

    // If the widget was running when last rendered (e.g. page reload), resume.
    if (widget.data.running) {
        startTick();
    } else {
        clearTimer();
    }
}

/** C2: thin alias over the shared registry — kept so existing call-sites read naturally. */
function clearPomodoroTimer(widgetId) { return clearWidgetTimer(widgetId); }

/**
 * Search Widget (multi-engine: Perplexity, Google, Bing, DuckDuckGo)
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
            // AbortController + setTimeout for broader browser compatibility.
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 10000);
            let res;
            try {
                res = await fetch(url, { signal: controller.signal });
            } finally {
                clearTimeout(timeoutId);
            }
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
            if (typeof announceStatus === 'function') {
                const sample = targets.slice(0, 3).map(c => `${c} ${fmtRate(rates[c])}`).join(', ');
                announceStatus(`Currency rates updated: $1 ${fromCode} → ${sample}.`);
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
function renderHabits(widget, container) {
    widget.data = widget.data || {};
    if (!Array.isArray(widget.data.habits)) widget.data.habits = [];
    if (typeof widget.data.log !== 'object' || widget.data.log === null) widget.data.log = {};

    // B6: log pruning now happens once at load time in app.js init() via pruneHabitsLog().
    container.innerHTML = '';

    // ── Helpers ────────────────────────────────────────────────
    // B6: _dateKey is a module-level helper (see top of this file).

    // Build the last-7-days array ending today.
    function lastSevenDays() {
        const days = [];
        for (let i = 6; i >= 0; i--) {
            const d = new Date();
            d.setDate(d.getDate() - i);
            days.push({ key: _dateKey(d), label: d.toLocaleDateString(undefined, { weekday: 'short' }) });
        }
        return days;
    }

    function isDone(habitId, dateKey) {
        const arr = widget.data.log[dateKey];
        return Array.isArray(arr) && arr.includes(habitId);
    }

    // ── Render ────────────────────────────────────────────────
    function renderGrid() {
        if (widget.data.habits.length === 0) {
            // C5: shared copy from registry metadata.
            container.innerHTML = `<p class="habit-empty">${escapeHtml(emptyStateText(widget))}</p>`;
            return;
        }

        const days = lastSevenDays();
        const todayKey = _dateKey(new Date());

        // Header row: day labels.
        let html = '<div class="habit-grid" role="table" aria-label="Habit completion grid">';
        html += '<div class="habit-header-row" role="row"><span class="habit-col-name"></span>';
        for (const d of days) {
            const isToday = d.key === todayKey;
            html += `<span class="habit-day-label${isToday ? ' habit-today' : ''}" role="columnheader">${escapeHtml(d.label)}</span>`;
        }
        html += '</div>';

        // One row per habit.
        for (const h of widget.data.habits) {
            html += `<div class="habit-row" role="row" data-habit-id="${escapeAttr(h.id)}">`;
            html += `<span class="habit-col-name" title="${escapeHtml(h.label)}">${escapeHtml(h.label)}</span>`;
            for (const d of days) {
                const done = isDone(h.id, d.key);
                const clickable = d.key === todayKey; // only today is toggleable
                html += `
                    <button type="button" class="habit-cell${done ? ' habit-done' : ''}${clickable ? ' habit-clickable' : ''}"
                            role="cell"
                            aria-label="${escapeHtml(h.label)} — ${d.label}: ${done ? 'completed' : 'not completed'}"
                            data-habit-id="${escapeAttr(h.id)}" data-date-key="${d.key}"${clickable ? '' : ' disabled'}>
                        ${done ? '✓' : ''}
                    </button>`;
            }
            html += '</div>';
        }
        html += '</div>';

        container.innerHTML = html;
    }

    renderGrid();

    // ── Toggle handler (delegated on the grid) ────────────────
    function handleToggle(e) {
        const cell = e.target.closest('.habit-cell');
        if (!cell || !cell.classList.contains('habit-clickable')) return;

        const habitId  = cell.dataset.habitId;
        const dateKey  = cell.dataset.dateKey;

        // Toggle: add or remove from today's log.
        if (isDone(habitId, dateKey)) {
            widget.data.log[dateKey] = (widget.data.log[dateKey] || []).filter(id => id !== habitId);
        } else {
            if (!Array.isArray(widget.data.log[dateKey])) widget.data.log[dateKey] = [];
            widget.data.log[dateKey].push(habitId);
        }

        // Persist + re-render just this card.
        saveFullState();
        renderGrid();
    }

    container.addEventListener('click', handleToggle);
}

