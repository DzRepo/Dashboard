/**
 * app/palette.js — Command Palette (⌘K / Ctrl+K). A lightweight global overlay to jump
 * to a widget or open a shortcut link. Intentionally SEPARATE from #modal-container so it
 * doesn't fight the modal Escape/focus-trap handlers. Results are built fresh each open;
 * activation resolves links by stable item index (P1-2), never label equality.
 */

const palette = {
    el: null,
    inputEl: null,
    listEl: null,
    results: [],      // current filtered [{kind, id?, widgetId?, label, sublabel?}]
    activeIndex: 0,
    lastFocusedBeforeOpen: null
};

function _paletteInit() {
    palette.el = document.getElementById('command-palette');
    if (!palette.el) return; // markup missing — degrade gracefully (no-op)
    palette.inputEl = document.getElementById('palette-input');
    palette.listEl  = document.getElementById('palette-results');

    // Open on ⌘K / Ctrl+K. Must not collide with the existing '/' + Alt+P handler and must
    // not open when a modal is already up or while typing in a field (Cmd/Ctrl combos are fine).
    document.addEventListener('keydown', (e) => {
        const isCombo = (e.metaKey || e.ctrlKey) && !e.shiftKey && !e.altKey;
        if (!isCombo) return;
        if ((e.key === 'k' || e.key === 'K')) {
            // Don't open on top of an existing modal.
            if (!modalContainer.hidden) { e.preventDefault(); return; }
            e.preventDefault();
            _paletteOpen();
        } else if (e.key === 'Escape') {
            // Let the normal Escape handling below close it first pass.
        }
    });

    // While open: handle input, navigation, and closing. Bound to the palette element so it
    // only fires when the overlay is in the DOM focus path (and we gate on !hidden anyway).
    palette.el.addEventListener('keydown', _paletteKeydown);
    palette.inputEl.addEventListener('input', () => { _paletteRender(palette.inputEl.value); });
    // Clicking outside the content closes it.
    palette.el.addEventListener('mousedown', (e) => {
        if (e.target === palette.el) _paletteClose();
    });
}

function _paletteBuildResults(query) {
    const q = String(query || '').trim().toLowerCase();
    const out = [];
    const widgets = Array.isArray(state.widgets) ? state.widgets : [];

    for (const w of widgets) {
        // 1. The widget itself.
        if (!q || String(w.title || '').toLowerCase().includes(q)) {
            out.push({ kind: 'widget', id: w.id, label: w.title || w.type, sublabel: 'Widget' });
        }

        // 2. Shortcut links inside a shortcuts widget.
        if (w.type === 'shortcuts' && Array.isArray(w.data?.items)) {
            w.data.items.forEach((item, index) => {
                const label = String(item.label || '');
                const desc  = String(item.description || '');
                const url   = String(item.url || '');
                if (!q || label.toLowerCase().includes(q) || desc.toLowerCase().includes(q) || url.toLowerCase().includes(q)) {
                    // Carry the item's index as stable identity so activation can
                    // resolve the exact URL even when labels are duplicated (P1-2).
                    out.push({ kind: 'link', widgetId: w.id, id: null, itemIndex: index, label, sublabel: url });
                }
            });
        }
    }

    // Cap to keep the list usable; widgets first (stable), then links.
    return out.slice(0, 50);
}

function _paletteRender(query) {
    const results = _paletteBuildResults(query);
    palette.results = results;
    palette.activeIndex = Math.min(palette.activeIndex, Math.max(0, results.length - 1));

    if (!palette.listEl) return;
    palette.listEl.innerHTML = '';

    if (results.length === 0) {
        const li = document.createElement('li');
        li.className = 'palette-empty';
        li.textContent = query ? `No matches for “${query}”.` : 'Nothing to show yet.';
        palette.listEl.appendChild(li);
        return;
    }

    results.forEach((r, i) => {
        const li = document.createElement('li');
        li.className = 'palette-item' + (i === palette.activeIndex ? ' active' : '');
        li.dataset.index = String(i);
        li.setAttribute('role', 'option');
        li.setAttribute('aria-selected', i === palette.activeIndex ? 'true' : 'false');

        const icon = r.kind === 'widget' ? '▣' : '↗';
        li.innerHTML = `<span class="palette-item-icon" aria-hidden="true">${icon}</span>` +
            `<div class="palette-item-text"><strong>${escapeHtml(r.label)}</strong>` +
            (r.sublabel ? `<small>${escapeHtml(r.sublabel)}</small>` : '') + `</div>`;

        li.addEventListener('click', () => _paletteActivate(i));
        palette.listEl.appendChild(li);
    });
}

function _paletteSetActive(index) {
    if (!palette.results.length) return;
    // Wrap around for smooth navigation.
    const n = palette.results.length;
    palette.activeIndex = ((index % n) + n) % n;
    if (palette.listEl) {
        palette.listEl.querySelectorAll('.palette-item').forEach((li, i) => {
            li.classList.toggle('active', i === palette.activeIndex);
            li.setAttribute('aria-selected', i === palette.activeIndex ? 'true' : 'false');
        });
        // Keep the active item in view.
        const active = palette.listEl.querySelector('.palette-item.active');
        if (active) active.scrollIntoView({ block: 'nearest' });
    }
}

function _paletteActivate(index) {
    const r = palette.results[index];
    if (!r) return;
    _paletteClose(); // close first so focus returns, then act.

    if (r.kind === 'widget') {
        const card = dashboardGrid.querySelector(`.widget-card[data-id="${CSS.escape(r.id)}"]`);
        if (card) {
            card.scrollIntoView({ behavior: 'smooth', block: 'center' });
            // Flash to draw the eye. Remove on animationend so a later jump can re-trigger it.
            const clearFlash = () => { card.classList.remove('palette-flash'); card.removeEventListener('animationend', clearFlash); };
            card.addEventListener('animationend', clearFlash, { once: true });
            card.classList.remove('palette-flash');
            void card.offsetWidth; // force reflow to restart the animation
            card.classList.add('palette-flash');
        }
    } else if (r.kind === 'link') {
        const widget = state.widgets.find(w => w.id === r.widgetId);
        // Resolve by the stable item index carried on the result (P1-2) — never
        // by label equality, which breaks when two shortcuts share a label.
        const match = (widget && Array.isArray(widget.data?.items) && typeof r.itemIndex === 'number')
            ? widget.data.items[r.itemIndex] : null;
        const url = match ? (match.url || '') : '';
        if (!url) {
            // Stale result (item removed since the list was built): no-op + announce.
            if (typeof announceStatus === 'function') announceStatus('That link is no longer available.');
            return;
        }
        if (/^https?:\/\//i.test(url)) {
            // Shortcut items carry their own per-item flag; fall back to the widget config,
            // which defaults to "new tab" when unset (consistent with runPerplexitySearch).
            const openInNewTab = match ? !!match.openInNewTab : (widget?.config?.openInNewTab !== false);
            window.open(url, openInNewTab ? '_blank' : '_self', 'noopener,noreferrer');
        }
    }
}

function _paletteKeydown(e) {
    if (e.key === 'Escape') { e.preventDefault(); _paletteClose(); return; }
    // Keep focus inside the palette: swallow Tab so it doesn't escape to page content.
    if (e.key === 'Tab') { e.preventDefault(); palette.inputEl.focus(); return; }

    if (e.key === 'ArrowDown')  { e.preventDefault(); _paletteSetActive(palette.activeIndex + 1); return; }
    if (e.key === 'ArrowUp')    { e.preventDefault(); _paletteSetActive(palette.activeIndex - 1); return; }
    if (e.key === 'Enter')      { e.preventDefault(); _paletteActivate(palette.activeIndex); return; }
}

function _paletteOpen() {
    if (!palette.el) return;
    palette.lastFocusedBeforeOpen = document.activeElement;
    // Start fresh each open.
    palette.inputEl.value = '';
    palette.activeIndex = 0;
    _paletteRender('');
    palette.el.hidden = false;
    requestAnimationFrame(() => {
        palette.inputEl.focus();
        if (typeof announceStatus === 'function') announceStatus('Command palette opened.');
    });
}

function _paletteClose() {
    if (!palette.el || palette.el.hidden) return;
    palette.el.hidden = true;
    // Restore focus to whatever triggered the palette.
    const prev = palette.lastFocusedBeforeOpen;
    palette.lastFocusedBeforeOpen = null;
    if (prev && typeof prev.focus === 'function') {
        try { prev.focus(); } catch (_) {}
    }
}

// Publish the public API on the shared namespace.
Dashboard._paletteInit = _paletteInit;
