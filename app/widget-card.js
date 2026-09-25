/**
 * app/widget-card.js — createWidgetElement: builds the DOM for a single widget card
 * (header with drag handle + title, action buttons, and the per-widget content container),
 * applies any user-chosen card fill color (with dark-mode lightness nudge + edge border),
 * and wires the drag/keyboard-reorder listeners. Called by renderDashboard() in boot.js
 * for every widget on each (re)render. Published to Dashboard.createWidgetElement.
 */

function createWidgetElement(widget) {
    const card = document.createElement('div');
    card.className = 'widget-card' + (widget.span && widget.span > 1 ? ` span-${widget.span}` : '');
    card.dataset.id = widget.id;

    // T22: optional per-widget icon glyph shown next to the title.
    const widgetIcon = (typeof widget.icon === 'string' && widget.icon.trim())
        ? `<span class="widget-icon" aria-hidden="true">${escapeHtml(widget.icon)}</span>` : '';

    card.innerHTML = `
        <div class="widget-header">
            <div class="widget-title-wrap">
                ${widgetIcon}
                <span class="widget-drag-handle" role="button" tabindex="0"
                    title="Drag to reorder — or focus and use the arrow keys"
                    aria-label="Reorder ${escapeHtml(widget.title)}: drag with the mouse, or focus and use the arrow keys">⠿</span>
                <h2 class="widget-title">${escapeHtml(widget.title)}</h2>
            </div>
            <div class="actions-container"></div>
        </div>
        <div class="widget-content" id="content-${widget.id}"></div>
    `;

    const actions = document.createElement('div');
    actions.className = 'widget-actions';
    // Delete now lives on the Edit page (see openEditWidgetModal's danger zone).
    // The header control is a gear icon that opens the same edit modal.

    // T12: Weather + Stocks get a ↻ refresh icon next to the gear.
    const showRefresh = (widget.type === 'weather' || widget.type === 'stocks');
    const refreshBtnHtml = showRefresh ? `
        <button class="action-btn action-icon" data-action="refresh" title="Refresh ${escapeHtml(widget.title)}" aria-label="Refresh ${escapeHtml(widget.title)}">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><polyline points="23 4 23 10 17 10"></polyline><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"></path></svg>
        </button>` : '';

    actions.innerHTML = `
        ${refreshBtnHtml}
        <button class="action-btn action-icon" data-action="edit" title="Edit Widget" aria-label="Edit ${escapeHtml(widget.title)}">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="3"></circle><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1-1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 3 18.4a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 .33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33z"></path></svg>
        </button>
    `;

    card.querySelector('.actions-container').appendChild(actions);

    // Expose the effective card background to descendants (e.g. the gear icon)
    // so they can match it. Defaults to transparent; overridden below if a fill is set.
    card.style.setProperty('--card-fill', 'transparent');

    // Per-widget fill color: when set, override the theme's --card-bg for this card.
    if (widget.fillColor && /^#[0-9a-fA-F]{6}$/.test(widget.fillColor)) {
        // Optional per-widget opacity (0–1). Defaults to fully opaque so existing
        // widgets keep their solid look; a slider in the Edit panel can lower it.
        let fillOpacity = 1;
        const rawOp = widget.fillOpacity;
        if (typeof rawOp === 'number' && isFinite(rawOp)) {
            fillOpacity = Math.min(1, Math.max(0.05, rawOp));
        }

        // Convert #RRGGBB → rgba(r,g,b,a) so the chosen color can be semi-transparent.
        // In dark mode, lighten a user-chosen fill that is close to the near-black
        // background (#1a1a1a) so card edges stay distinguishable. Hue/saturation are
        // preserved; only lightness is nudged up for dark fills (see adjustFillForTheme).
        const rgb = hexToRgb(widget.fillColor);
        if (!rgb) return;
        const activeTheme = document.documentElement.getAttribute('data-theme');
        const { r, g, b } = adjustFillForTheme(rgb, activeTheme);

        const fillRgba = rgbaString(r, g, b, fillOpacity);

        card.style.background = 'none';
        card.style.backgroundColor = fillRgba;
        // Match the gear icon's background to this fill color (same opacity).
        card.style.setProperty('--card-fill', fillRgba);

        // Edge definition: in dark mode, add a thin border slightly darker than the
        // fill so the card edge is clearly distinguishable from both the page bg and
        // the fill itself. In light mode, use a subtle shadow-like border for depth.
        if (activeTheme === 'dark') {
            const br = Math.max(0, r - 35);
            const bg2 = Math.max(0, g - 35);
            const bb = Math.max(0, b - 35);
            card.style.border = `1px solid rgba(${br}, ${bg2}, ${bb}, 0.9)`;
        } else {
            // Light mode: a soft border one shade darker than the fill.
            const br = Math.max(0, r - 25);
            const bg2 = Math.max(0, g - 25);
            const bb = Math.max(0, b - 25);
            card.style.border = `1px solid rgba(${br}, ${bg2}, ${bb}, 0.6)`;
        }
    }

    // Render widget-specific content
    const contentContainer = card.querySelector(`#content-${widget.id}`);
    Dashboard.createWidgetContent(widget, contentContainer);

    // NOTE: click / keypress handlers for widget content are attached at the
    // dashboardGrid level (see init) so re-renders never stack duplicate listeners.
    // Action buttons (Edit / Delete) are also delegated at the grid level.

    // Drag and drop: the card only becomes draggable while the pointer is down on the grip handle,
    // so text selection and inputs inside the card are unaffected.
    const handle = card.querySelector('.widget-drag-handle');
    handle.addEventListener('pointerdown', () => {
        card.draggable = true;
        const reset = () => {
            card.draggable = false;
            document.removeEventListener('pointerup', reset);
        };
        document.addEventListener('pointerup', reset);
    });

    // Keyboard reordering (accessible alternative to the old up/down arrow buttons).
    handle.addEventListener('keydown', (e) => {
        if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') {
            e.preventDefault();
            reorderWidgetByOffset(widget.id, -1);
        } else if (e.key === 'ArrowDown' || e.key === 'ArrowRight') {
            e.preventDefault();
            reorderWidgetByOffset(widget.id, 1);
        }
    });

    card.addEventListener('dragstart', (e) => handleDragStart(e, card));
    card.addEventListener('dragend', (e) => handleDragEnd(e, card));
    card.addEventListener('dragover', (e) => handleDragOver(e, card));
    card.addEventListener('drop', (e) => handleDrop(e, card));

    return card;
}

// Publish the public API on the shared namespace.
Dashboard.createWidgetElement = createWidgetElement;
