/**
 * app/modals/edit-widget.js — the Add-Widget and Edit-Widget modals. Both are fully
 * registry-driven: the add modal builds its type buttons from WidgetRegistry, and
 * the edit modal renders each type's fields via entry.editFields + saves via
 * entry.applyEdit. Shared "list of rows" editors (clock times, tickers, events,
 * codes, habits) are wired by wireRowEditor. Published to Dashboard.
 */

function openAddWidgetModal() {
    // Build the widget-type buttons from the registry so new types appear
    // automatically without editing this function.
    // each button now carries an optional hint from registry metadata, rendered
    // as a small caption below the label. New types that set `hint` get it for free.
    const typeButtons = Object.keys(Dashboard.WidgetRegistry).map(type => {
        const entry = Dashboard.WidgetRegistry[type];
        const hint = (entry && typeof entry.hint === 'string') ? `<span class="widget-type-hint">${escapeHtml(entry.hint)}</span>`: '';
        return `<button data-type="${type}"><span class="widget-type-label">${escapeHtml(entry.label)}</span>${hint}</button>`;
    }).join('');

    modalBody.innerHTML = `
        <h3 style="margin-top:0;">Add New Widget</h3>
        <p>Select a widget type to add to your dashboard:</p>
        <div class="widget-options">
            ${typeButtons}
        </div>
    `;
    // set the accessible name so screen readers announce "Add New Widget".
    _setModalTitle('Add New Widget');
    modalContainer.hidden = false;
    _focusIntoModal();

    modalBody.querySelectorAll('button[data-type]').forEach(btn => {
        btn.addEventListener('click', () => {
            const type = btn.dataset.type;
            addWidget(type);
            closeModal();
        });
    });
}

function openEditWidgetModal(widget) {
    // the edit UI is fully registry-driven. Every registered type has an
    // editFields function, so the old per-type `else if` fallbacks (search/clock) were
    // unreachable dead code and are deleted. A new widget type now needs only a registry
    // entry — zero edits here.
    const entry = Dashboard.WidgetRegistry[widget.type];
    let fieldsHtml = '';
    if (entry && typeof entry.editFields === 'function') {
        try { fieldsHtml = entry.editFields(widget); } catch (e) { console.warn('editFields failed', e); }
    }

    // Size selector (span 1/2/3) — available for every widget type.
    const currentSpan = [1, 2, 3].includes(widget.span) ? widget.span: 1;
    const spanHtml = `
        <div class="settings-group">
            <label>Size:</label>
            <select id="edit-widget-span">
                <option value="1" ${currentSpan === 1 ? 'selected': ''}>Small (1 column)</option>
                <option value="2" ${currentSpan === 2 ? 'selected': ''}>Medium (2 columns)</option>
                <option value="3" ${currentSpan === 3 ? 'selected': ''}>Large (3 columns)</option>
            </select>
        </div>
    `;

    // per-widget icon — a shared dropdown of Material-style glyphs, shown next
    // to the title. Empty value = no icon (original look). Applies to every type.
    const WIDGET_ICONS = [
        { v: '',            label: '(none)' },
        { v: '🕒', label: '🕒  Clock' },
        { v: '⏱️', label: '⏱️ Timer / Pomodoro' },
        { v: '💱', label: '💱 Currency' },
        { v: '✅', label: '✅ Lists / Todo' },
        { v: '🔎', label: '🔎 Search' },
        { v: '☀️', label: '☀️ Weather' },
        { v: '📈', label: '📈 Stocks' },
        { v: '🔗', label: '🔗 Shortcuts / Links' },
        { v: '⏳', label: '⏳ Countdown' },
        { v: '📰', label: '📰 RSS / News' },
        { v: '🌿', label: '🌿 Habits' },
        { v: '📝', label: '📝 Notes' }
    ];
    const currentIcon = (typeof widget.icon === 'string') ? widget.icon: '';
    const iconOptions = WIDGET_ICONS.map(ic => {
        // If the stored icon isn't in our curated list, offer it as a custom option.
        return `<option value="${escapeHtml(ic.v)}" ${ic.v === currentIcon ? 'selected': ''}>${escapeHtml(ic.label)}</option>`;
    }).join('');
    const hasCustomIcon = currentIcon && !WIDGET_ICONS.some(ic => ic.v === currentIcon);
    // If a stored icon isn't in our curated list, offer it as the first (selected) option.
    const customOptionHtml = hasCustomIcon
        ? `<option value="${escapeHtml(currentIcon)}" selected>${escapeHtml(currentIcon)} (custom)</option>`
: '';
    const iconHtml = `
        <div class="settings-group">
            <label>Icon:</label>
            <select id="edit-widget-icon">${customOptionHtml}${iconOptions}</select>
            <p style="font-size:10px;margin-top:4px;opacity:.7;">Shown next to the widget title. “(none)” removes it.</p>
        </div>
    `;

    // Fill color — available for every widget type. Empty = use theme default.
    const currentFill = /^#[0-9a-fA-F]{6}$/.test(widget.fillColor || '') ? widget.fillColor: '';
    // Opacity defaults to 1 (fully opaque) unless a number was previously stored.
    let currentOpacity = 1;
    if (typeof widget.fillOpacity === 'number' && isFinite(widget.fillOpacity)) {
        currentOpacity = Math.min(1, Math.max(0.05, widget.fillOpacity));
    }
    const fillHtml = `
        <div class="settings-group">
            <label>Card fill color:</label>
            <div style="display:flex; align-items:center; gap:10px; margin-top:4px;">
                <input type="color" id="edit-widget-fill" value="${currentFill || '#2a2a3e'}" aria-label="Choose a card fill color"
                       style="width:48px;height:36px;border:none;padding:0;cursor:pointer;background:none;">
                <div id="fill-preview-swatch" style="flex:1;height:36px;border-radius:6px;display:flex;align-items:center;justify-content:center;font-size:12px;color:#ccc;border:1px solid rgba(0,0,0,0.5);background:${currentFill || '#2a2a3e'};">
                    ${currentFill ? 'Preview': 'No fill (theme default)'}
                </div>
            </div>
            <div style="margin-top:8px;">
                <label for="edit-widget-fill-opacity">Opacity:</label>
                <input type="range" id="edit-widget-fill-opacity" min="5" max="100" step="5"
                       value="${Math.round(currentOpacity * 100)}" aria-label="Card fill opacity">
            </div>
            <button type="button" id="edit-widget-fill-clear" style="margin-top:6px;">Use theme default</button>
        </div>
    `;

    // Delete lives on the Edit page for every widget type.
    const deleteHtml = `
        <hr class="edit-danger-divider">
        <div class="settings-group edit-danger-zone">
            <label>Remove this widget:</label>
            <button id="edit-delete" type="button" class="danger">Delete Widget</button>
        </div>
    `;

    modalBody.innerHTML = `
        <h3 style="margin-top:0;">Edit Widget</h3>
        <div class="settings-group">
            <label>Title:</label>
            <input type="text" id="edit-widget-title" value="${escapeHtml(widget.title)}">
        </div>
        ${spanHtml}
        ${iconHtml}
        ${fillHtml}
        ${fieldsHtml}
        <div class="modal-actions">
            <button id="edit-save" class="primary">Save</button>
        </div>
        ${deleteHtml}
    `;
    // set the accessible name so screen readers announce "Edit Widget".
    _setModalTitle('Edit Widget');
    modalContainer.hidden = false;
    _focusIntoModal();

    // ── Live fill-color preview swatch ────────────────────────────────────────
    const fillInput   = document.getElementById('edit-widget-fill');
    const opacityEl   = document.getElementById('edit-widget-fill-opacity');
    const swatch      = document.getElementById('fill-preview-swatch');

    function _updateFillPreview() {
        if (!swatch) return;
        const hex  = fillInput ? (fillInput.value || '').trim(): '';
        const pct  = opacityEl ? parseInt(opacityEl.value, 10) / 100: 1;
        const rgb  = hexToRgb(hex);
        if (rgb) {
            swatch.style.background = rgbaString(rgb.r, rgb.g, rgb.b, pct);
            swatch.textContent     = 'Preview';
        } else {
            swatch.style.background = 'transparent';
            swatch.textContent     = 'No fill (theme default)';
        }
    }

    if (fillInput && opacityEl) {
        fillInput.addEventListener('input', _updateFillPreview);
        opacityEl.addEventListener('input', _updateFillPreview);
    }
    // ──────────────────────────────────────────────────────────────────────────

    // Shortcuts: "+ Add link" now lives on this Edit page. Adding a link saves
    // immediately and re-renders just that widget's card, so it appears in the list
    // without needing to press Save first.
    if (widget.type === 'shortcuts') {
        const addLinkBtn = document.getElementById('shortcut-add-link');
        if (addLinkBtn) {
            addLinkBtn.addEventListener('click', () => {
                const labelEl  = document.getElementById('shortcut-new-label');
                const urlEl    = document.getElementById('shortcut-new-url');
                const descEl   = document.getElementById('shortcut-new-desc');
                let label = (labelEl && labelEl.value.trim()) || '';
                let url   = (urlEl  && urlEl.value.trim()) || '';
                if (!label || !url) { alert('Please enter both a label and a URL.'); return; }
                if (!/^https?:\/\//i.test(url)) url = 'https://' + url;
                if (!Dashboard.Storage.isValidHttpUrl(url)) {
                    alert('Invalid URL — only http:// or https:// links are allowed.');
                    return;
                }
                widget.data = widget.data || {};
                widget.data.items = widget.data.items || [];
                const description = (descEl && descEl.value.trim()) || '';
                widget.data.items.push({ label, url, description, openInNewTab: true });
                saveFullState();

                // Update the card in place so it shows up immediately.
                const card = dashboardGrid.querySelector(`.widget-card[data-id="${widget.id}"]`);
                if (card) Dashboard.renderShortcuts(widget, card.querySelector('.widget-content'));

                // Clear the form for another entry; keep focus on the label field.
                if (labelEl) { labelEl.value = ''; }
                if (urlEl)   { urlEl.value = ''; }
                if (descEl)  { descEl.value = ''; }
                if (labelEl) labelEl.focus();
            });
        }
    }

    // Wire up the clock times editor (only present for clock widgets).
    if (widget.type === 'clock') {
        wireRowEditor({
            editorId: 'clock-times-editor',
            addBtnId: 'clock-add-time',
            focusSelector: '.clock-time-zone',
            newRowHtml: `
                <div class="clock-time-row">
                    <input type="text" class="clock-time-label" placeholder="Label (e.g. Home)">
                    <input type="text" class="clock-time-zone" placeholder="Timezone (e.g. America/New_York)">
                    <button type="button" class="clock-remove-entry" title="Remove entry">×</button>
                </div>`
        });
    }

    /**
     * Shared wiring for every "list of rows" row editor (clock times, stock
     * tickers, countdown events, currency codes, habits). Each widget
     * supplies its own DOM specifics; the add/remove behavior is implemented once.
     * Convention: existing rows render `<type>-remove-entry` and new rows added in-session
     * use the same class (see each config below), so removal works identically for both —
     * this makes the style "saved row's × does nothing" bug structurally impossible.
     */
    function wireRowEditor({ editorId, addBtnId, newRowHtml, focusSelector }) {
        const editor = document.getElementById(editorId);
        if (!editor) return;

        // Remove a row when its × button is clicked (event delegation).
        editor.addEventListener('click', (e) => {
            const btn = e.target.closest('[class*="-remove-entry"]');
            if (!btn || !editor.contains(btn)) return;
            const row = btn.parentElement; // the <div> that wraps this row's inputs
            if (row && editor.contains(row)) row.remove();
        });

        const addBtn = document.getElementById(addBtnId);
        if (!addBtn) return;
        addBtn.addEventListener('click', () => {
            const hint = editor.querySelector('.hint');
            if (hint) hint.remove();
            const wrap = document.createElement('div');
            wrap.innerHTML = newRowHtml;
            const appended = [];
            Array.from(wrap.childNodes).forEach(n => {
                editor.appendChild(n);
                appended.push(n);
            });
            // Focus within the newly inserted row, not the first match in the editor.
            const newRow = appended.find(n => n.nodeType === 1) || null;
            const focusEl = focusSelector && newRow
                ? newRow.querySelector(focusSelector)
: (focusSelector ? editor.querySelector(focusSelector): null);
            if (focusEl && typeof focusEl.focus === 'function') focusEl.focus();
        });
    }

    // Wire up the stock symbols editor (only present for stocks widgets).
    if (widget.type === 'stocks') {
        wireRowEditor({
            editorId: 'stock-symbols-editor',
            addBtnId: 'stock-add-symbol',
            focusSelector: '.stock-symbol-input',
            newRowHtml: `
                <div class="stock-symbol-row">
                    <input type="text" class="stock-symbol-input" placeholder="TICKER">
                    <input type="text" class="stock-name-input" placeholder="Company name">
                    <button type="button" class="stock-remove-entry" title="Remove">×</button>
                </div>`
        });
    }

    // Wire up the currency multi-code editor (only present for currency widgets).
    if (widget.type === 'currency') {
        wireRowEditor({
            editorId: 'currency-codes-editor',
            addBtnId: 'currency-add-code',
            focusSelector: '.currency-code-input',
            newRowHtml: `
                <div class="currency-code-row">
                    <input type="text" maxlength="3" class="currency-code-input"
                           style="text-transform:uppercase; width:72px;" placeholder="CODE" aria-label="Currency code">
                    <button type="button" class="currency-remove-entry" title="Remove">×</button>
                </div>`
        });
    }

    // Wire up the countdown events editor (only present for countdown widgets).
    if (widget.type === 'countdown') {
        wireRowEditor({
            editorId: 'countdown-events-editor',
            addBtnId: 'countdown-add-event',
            focusSelector: '.countdown-ev-label',
            // Default to now + 7 days so the datetime picker has a sensible start.
            newRowHtml: `
                <div class="countdown-event-row">
                    <input type="text" class="countdown-ev-label" placeholder="Label (e.g. Launch)">
                    <input type="datetime-local" class="countdown-ev-dt" step="60" value="${escapeAttr(toLocalInputValue(new Date(Date.now() + 7 * 86400000)))}">
                    <button type="button" class="countdown-remove-entry" title="Remove event">×</button>
                </div>`
        });
    }

    // Wire up the Habit Tracker row editor (add/remove habits).
    if (widget.type === 'habits') {
        wireRowEditor({
            editorId: 'habit-editor',
            addBtnId: 'habit-add-row',
            focusSelector: '.habit-label-input',
            newRowHtml: `
                <div class="habit-row-editor">
                    <input type="text" class="habit-label-input" placeholder="Habit name (e.g. Read 20 min)">
                    <button type="button" class="habit-remove-entry" title="Remove habit">×</button>
                </div>`
        });
    }

    // Fill color: "Use theme default" clears it; otherwise persist the hex from <input type=color>.
    const fillClearBtn = document.getElementById('edit-widget-fill-clear');
    if (fillClearBtn) {
        let cleared = false;
        fillClearBtn.addEventListener('click', () => {
            cleared = true;
            // Reset the preview swatch to a neutral "no fill" state.
            const _sw  = document.getElementById('fill-preview-swatch');
            if (_sw) { _sw.style.background = 'transparent'; _sw.textContent = 'No fill (theme default)'; }
        });
        // We read `cleared` inside the save handler below via a closure flag.
        widget.__fillClearedFlag = () => cleared;
    }

    document.getElementById('edit-save').addEventListener('click', () => {
        widget.title = document.getElementById('edit-widget-title').value.trim() || widget.title;

        // Persist the size / span selection.
        const spanEl = document.getElementById('edit-widget-span');
        if (spanEl) widget.span = parseInt(spanEl.value, 10);

        // persist the per-widget icon glyph ('' = none).
        const iconEl = document.getElementById('edit-widget-icon');
        if (iconEl) {
            const v = iconEl.value.trim();
            if (v) widget.icon = v; else delete widget.icon;
        }

        // Persist fill color (or clear it).
        const clearedFlag = typeof widget.__fillClearedFlag === 'function' ? widget.__fillClearedFlag(): false;
        delete widget.__fillClearedFlag;
        if (clearedFlag) {
            delete widget.fillColor; // fall back to theme default
            delete widget.fillOpacity;
        } else {
            const fillEl = document.getElementById('edit-widget-fill');
            if (fillEl && /^#[0-9a-fA-F]{6}$/.test(fillEl.value)) widget.fillColor = fillEl.value;
            // Persist opacity only when a fill color is actually set.
            const opEl = document.getElementById('edit-widget-fill-opacity');
            if (widget.fillColor && opEl) {
                const pct = parseInt(opEl.value, 10);
                widget.fillOpacity = Math.min(1, Math.max(0.05, pct / 100));
            } else if (!widget.fillColor) {
                delete widget.fillOpacity;
            }
        }

        // type-specific save logic now lives on the registry entry (applyEdit),
        // so this handler is generic. Each type owns defaults → render → edit UI → save.
        widget.config = widget.config || {};

        if (entry && typeof entry.applyEdit === 'function') {
            try { entry.applyEdit(widget, modalBody); } catch (e) { console.warn('applyEdit failed', e); }
        }

        // (Type-specific save logic moved to each registry entry's applyEdit — see above.)

        saveFullState();
        renderDashboard();
        closeModal();
    });

    // Lists / Todo — "Clear completed" action now lives on the Edit page.
    const clearCompletedBtn = document.getElementById('edit-lists-clear-completed');
    if (clearCompletedBtn) {
        clearCompletedBtn.addEventListener('click', () => {
            widget.data = widget.data || {};
            widget.data.items = widget.data.items || [];
            // Snapshot the completed items we're about to remove so Undo can restore them.
            const removedItems = widget.data.items.filter(i => i.completed);
            if (removedItems.length === 0) { alert('There are no completed items to clear.'); return; }

            widget.data.items = widget.data.items.filter(i => !i.completed);
            saveFullState();
            renderDashboard();
            closeModal();

            // Undo: put the removed items back at their original positions.
            showUndoToast(`Cleared ${removedItems.length} completed item${removedItems.length === 1 ? '': 's'}`, () => {
                widget.data = widget.data || {};
                widget.data.items = widget.data.items || [];
                // Re-insert each removed item at the end (simplest correct restore);
                // user can reorder manually if they care about exact positions.
                for (const it of removedItems) widget.data.items.push(JSON.parse(JSON.stringify(it)));
                saveFullState();
                renderDashboard();
            });
        });
    }

    // Delete this widget from the Edit page (all types).
    const deleteBtn = document.getElementById('edit-delete');
    if (deleteBtn) {
        deleteBtn.addEventListener('click', () => {
            if (!confirm('Are you sure you want to remove "' + widget.title + '"?')) return;

            // Snapshot for undo BEFORE we mutate. Deep-clone so later edits don't leak in.
            const snapshot = JSON.parse(JSON.stringify(widget));
            const indexInArray = state.widgets.findIndex(w => w.id === widget.id);

            state.widgets = state.widgets.filter(w => w.id !== widget.id);
            saveFullState();
            Dashboard.clearClockTimer(widget.id);
            Dashboard.clearCountdownTimer(widget.id);
            if (typeof Dashboard.clearPomodoroTimer === 'function') Dashboard.clearPomodoroTimer(widget.id); //
            renderDashboard();
            closeModal();

            // Undo: re-insert at the same index (or end if out of range) and restore timers.
            const label = `Deleted ${widget.title}`;
            showUndoToast(label, () => {
                const clone = JSON.parse(JSON.stringify(snapshot));
                state.widgets.splice(Math.min(indexInArray, state.widgets.length), 0, clone);
                saveFullState();
                // renderDashboard mounts widgets via the registry (including timers).
                renderDashboard();
            });
        });
    }
}

/**
 * NOTE: the clock's time-entry editor is defined once, in WidgetRegistry['clock'].editFields
 * (registry.js). It used to also exist here as buildClockTimesEditor, which was a duplicate
 * source of truth and could render the existing clocks twice. Removed — keep only the registry copy.
 */

// Publish the public API on the shared namespace.
Dashboard.openAddWidgetModal = openAddWidgetModal;
Dashboard.openEditWidgetModal = openEditWidgetModal;
