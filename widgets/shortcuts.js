/**
 * shortcuts — widget renderer. Part of the widgets/ split (P2-10).
 * Classic script: top-level functions become globals.
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
            Dashboard.saveFullState();
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

// P2-9: publish on the shared namespace.
Dashboard.renderShortcuts = renderShortcuts;

if (typeof module !== 'undefined' && typeof module.exports !== 'undefined') {
    module.exports = globalThis.Dashboard;
}
