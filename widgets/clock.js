/**
 * clock — widget renderer. Part of the widgets/ split (P2-10).
 * Classic script: top-level functions become globals.
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
        // P1-6: no aria-live here. role="timer" has an implicit live value of "off",
        // so the per-second time update is not announced. (Explicitly setting
        // aria-live="polite" overrode that and made screen readers read the clock
        // every second.) Discrete events are announced via announceStatus() instead.

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

// P2-9: publish on the shared namespace.
Dashboard.renderClock = renderClock;
Dashboard.clockDayOffset = clockDayOffset;
Dashboard.clearClockTimer = clearClockTimer;

if (typeof module !== 'undefined' && typeof module.exports !== 'undefined') {
    module.exports = globalThis.Dashboard;
}
