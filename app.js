/**
 * Application State
 */
window.state = Storage.getData();

/**
 * DOM Elements
 */
const dashboardGrid = document.getElementById('dashboard-grid');
const addWidgetBtn = document.getElementById('add-widget-btn');
const settingsBtn = document.getElementById('settings-btn');
const modalContainer = document.getElementById('modal-container');
const modalBody = document.getElementById('modal-body');

// Tracks the element that opened the current modal so we can restore focus on close.
let lastFocusedBeforeModal = null;

/**
 * T6 — Load the background image from IndexedDB (if flagged) and set it on state.
 * Resolves immediately if there's nothing to load, so init() can await it safely.
 */
async function _loadBgImageFromIdb() {
    const bg = state.settings && state.settings.background;
    if (!bg || bg.type !== 'upload' || !bg.hasIdbImage) return; // nothing in IDB
    try {
        const dataUrl = await Storage._idbGetBgImage();
        if (typeof dataUrl === 'string' && dataUrl.length > 0) {
            state.settings.background.imageDataUrl = dataUrl;
        }
    } catch (e) {
        console.warn('T6: failed to load background image from IndexedDB', e);
    }
}

/**
 * Initialization
 */
async function init() {
    // T6: fetch the bg image blob before first paint so applySettings can use it.
    await _loadBgImageFromIdb();

    // B6: prune habit log entries older than 30 days once at load time and persist,
    // instead of mutating state inside renderHabits on every render (which was never saved).
    if (typeof pruneHabitsLog === 'function') {
        let pruned = false;
        for (const w of state.widgets) {
            if (w && w.type === 'habits' && pruneHabitsLog(w)) pruned = true;
        }
        if (pruned) saveFullState();
    }

    applySettings();
    renderDashboard();
    
    addWidgetBtn.addEventListener('click', openAddWidgetModal);
    settingsBtn.addEventListener('click', openSettingsModal);
    
    modalContainer.addEventListener('click', (e) => {
        if (e.target === modalContainer || e.target.closest('.modal-close')) {
            closeModal();
        }
    });

    // Grid-level drag handling: dropping in empty grid area moves a card to the end.
    dashboardGrid.addEventListener('dragover', handleGridDragOver);
    dashboardGrid.addEventListener('dragleave', handleGridDragLeave);
    dashboardGrid.addEventListener('drop', handleGridDrop);

    // Single delegated click listener for all widget interactions (actions + content).
    // Attaching here (once, on the stable grid element) means re-renders never
    // stack duplicate handlers — the render functions are pure DOM builders.
    dashboardGrid.addEventListener('click', handleGridClick);

    // I5: switched from deprecated 'keypress' to 'keydown'. The handler already
    // checks e.key === 'Enter', so behavior is identical; keydown also works more
    // predictably with modifier keys.
    dashboardGrid.addEventListener('keydown', handleGridKeypress);

    // Delegated input/change handlers for controls that need live updates:
    //   - .shortcut-filter  → filter shortcut items by label/desc/url (client-side)
    //   - .shortcut-sort    → re-render with "most used" vs manual ordering
    dashboardGrid.addEventListener('input', handleGridInput);
    dashboardGrid.addEventListener('change', handleGridChange);

    // Global keyboard shortcuts:
    //   "/"      → focus the first Perplexity search box (if not already typing)
    //   Alt+P    → same, as an unambiguous alternative
    document.addEventListener('keydown', handleGlobalShortcuts);

    // Command palette: ⌘K / Ctrl+K opens a global overlay that searches widget titles +
    // shortcut links. Registered here so it lives alongside the other keybindings.
    _paletteInit();

    // Escape closes any open modal; Tab is trapped inside the dialog while it's open.
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && !modalContainer.hidden) { e.preventDefault(); closeModal(); return; }
        _trapModalFocus(e);
    });

    // PWA: register the service worker only when served over http(s). Skip on file://
    // because browsers refuse to register a SW without a secure context.
    if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
        window.addEventListener('load', () => {
            navigator.serviceWorker.register('./sw.js').catch(err => {
                console.warn('[pwa] service worker registration failed:', err);
            });
        });
    }

    // Check for seed data
    if (state.widgets.length === 0) {
        seedDashboard();
    }
}

/**
 * Announce a short status message to screen readers via the #status-live-region.
 * The element is visually hidden but exposed as aria-live="polite" role="status",
 * so updates are read out without stealing focus. Safe no-op if the region is missing.
 */
function announceStatus(message) {
    const el = document.getElementById('status-live-region');
    if (!el || typeof message !== 'string' || !message.trim()) return;
    // Clear then set on next tick so repeated identical messages are re-announced.
    el.textContent = '';
    requestAnimationFrame(() => { el.textContent = message; });
}

/**
 * T18: Apply the global UI scale (zoom) by adjusting the root font size.
 * The dashboard is rem-based, so scaling `font-size` scales everything cleanly
 * without a transform. 100 = default (~16px).
 */
function _applyUiScale(pct) {
    if (!Number.isFinite(pct)) pct = 100;
    const clamped = Math.min(200, Math.max(50, pct));
    document.documentElement.style.fontSize = (clamped / 100 * 16).toFixed(2) + 'px';
}

/**
 * T18: Apply the grid column count. "auto"/null → theme default (auto-fill);
 * otherwise set a fixed repeat(n, 1fr) via --grid-cols and flag data-layout.
 */
function _applyGridColumns(value) {
    const root = document.documentElement;
    if (!value || value === 'auto') {
        root.removeAttribute('data-layout');
        root.style.removeProperty('--grid-cols');
        return;
    }
    const n = parseInt(value, 10);
    if (Number.isFinite(n) && n >= 2 && n <= 8) {
        root.setAttribute('data-layout', 'fixed');
        root.style.setProperty('--grid-cols', String(n));
    } else {
        root.removeAttribute('data-layout');
        root.style.removeProperty('--grid-cols');
    }
}

/**
 * UI Logic
 */
function applySettings() {
    const { theme, background } = state.settings;

    // T18: apply layout (columns + UI scale) first so the grid reflects settings.
    _applyGridColumns(state.settings.gridColumns);
    _applyUiScale(state.settings.uiScale != null ? state.settings.uiScale : 100);

    // Apply Theme
    if (theme === 'system') {
        const mq = window.matchMedia('(prefers-color-scheme: dark)');
        const applySystemTheme = () => {
            document.documentElement.setAttribute('data-theme', mq.matches ? 'dark' : 'light');
            _updateMetaThemeColor(); // C13: keep browser chrome in sync
        };
        applySystemTheme();
        // React to OS light/dark flips mid-session (fixes #5).
        if (mq.addEventListener) mq.addEventListener('change', applySystemTheme);
        else if (mq.addListener) mq.addListener(applySystemTheme); // Safari < 14
    } else {
        document.documentElement.setAttribute('data-theme', theme);
    }
    _updateMetaThemeColor(); // C13: sync meta after either branch

    // T13: Apply custom header background color + opacity (if set in Settings).
    const headerEl = document.querySelector('header');
    if (headerEl) {
        const hColor = state.settings.headerBgColor;
        const hOp = state.settings.headerOpacity != null ? state.settings.headerOpacity : 0.9;
        if (hColor && /^#[0-9a-fA-F]{6}$/.test(hColor)) {
            const rgb = hexToRgb(hColor);
            headerEl.style.background = rgbaString(rgb.r, rgb.g, rgb.b, hOp);
        } else {
            // No custom color — fall back to the theme's --header-bg var.
            headerEl.style.background = '';
        }
    }

    // Apply blur (fixes #4 — the slider was a no-op because nothing set the var).
    if (background && typeof background.blurPx === 'number') {
        document.documentElement.style.setProperty('--blur-amount', `${background.blurPx}px`);
    }

    // Apply dashboard title (renamable via Settings).
    const titleEl = document.getElementById('dashboard-title');
    if (titleEl) {
        const t = state.settings.dashboardTitle;
        titleEl.textContent = (typeof t === 'string' && t.trim()) ? t : 'My Dashboard';
    }

    // Apply Background
    const bgOverlay = document.getElementById('background-overlay');
    if (bgOverlay) {
        // Use the URL branch when type is 'url', OR when a URL exists and type isn't 'upload'
        // (handles legacy state where the user saved a URL but type was still 'none').
        if ((background.type === 'url' || background.type !== 'upload') && background.imageUrl) {
            // If the user entered a local absolute path (e.g. /Users/...),
            // convert it to a file:/// URL so the browser can load it.
            let bgSrc = background.imageUrl;
            if (bgSrc.startsWith('/') && !bgSrc.startsWith('//') && location.protocol === 'file:') {
                bgSrc = 'file://' + encodeURIComponent(bgSrc).replace(/%2F/g, '/');
            }
            bgOverlay.style.backgroundImage = `url(${bgSrc})`;
        } else if (background.type === 'upload') {
            // T6: imageDataUrl may be present inline (just uploaded / migrated) or
            // loaded from IDB by _loadBgImageFromIdb(). Either way it's on state now.
            const src = background.imageDataUrl;
            bgOverlay.style.backgroundImage = src ? `url(${src})` : 'none';
        } else {
            bgOverlay.style.backgroundImage = 'none';
        }
        
        const contentOverlay = document.querySelector('.background-overlay-content');
        if (contentOverlay) {
            contentOverlay.style.opacity = background.overlayOpacity;
        }
    }
}

/* ── Color utilities (I1) ────────────────────────────────────────────────
   Centralize the hex→rgb / rgba-string math that was copy-pasted across the
   header color, fill preview swatch, header live preview, and per-widget card
   fill. `adjustFillForTheme` encapsulates the dark-mode lightness nudge so a
   user-chosen near-black fill stays distinguishable on the #1a1a1a background.
*/
function hexToRgb(hex) {
    // Accepts '#RRGGBB' or 'RRGGBB'; returns {r,g,b} in 0–255, or null if invalid.
    let h = String(hex || '').trim();
    if (h.startsWith('#')) h = h.slice(1);
    if (!/^[0-9a-fA-F]{6}$/.test(h)) return null;
    return {
        r: parseInt(h.slice(0, 2), 16),
        g: parseInt(h.slice(2, 4), 16),
        b: parseInt(h.slice(4, 6), 16)
    };
}

function rgbaString(r, g, b, a) {
    return `rgba(${Math.round(r)}, ${Math.round(g)}, ${Math.round(b)}, ${a})`;
}

/**
 * Nudge a dark fill's lightness up so it reads against the near-black background.
 * Preserves hue/saturation; only raises L when L < ~0.45 (catches very-dark and
 * mid-dark grays). No-op in non-dark themes or for already-light fills.
 */
function adjustFillForTheme({ r, g, b }, theme) {
    if (theme !== 'dark') return { r, g, b };
    let rn = r / 255, gn = g / 255, bn = b / 255;
    const maxC = Math.max(rn, gn, bn), minC = Math.min(rn, gn, bn);
    let h = 0, s = 0; let l = (maxC + minC) / 2;
    if (maxC !== minC) {
        const d = maxC - minC;
        s = l > 0.5 ? d / (2 - maxC - minC) : d / (maxC + minC);
        switch (maxC) {
            case rn: h = ((gn - bn) / d + (gn < bn ? 6 : 0)); break;
            case gn: h = ((bn - rn) / d + 2); break;
            default: h = ((rn - gn) / d + 4);
        }
        h /= 6;
    }
    if (l < 0.45) l = Math.min(0.9, l + 0.32);

    const hue2rgb = (p, q, t) => {
        if (t < 0) t += 1;
        if (t > 1) t -= 1;
        if (t < 1 / 6) return p + (q - p) * 6 * t;
        if (t < 1 / 2) return q;
        if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
        return p;
    };
    let rr, gg, bb;
    if (s === 0) { rr = gg = bb = l; }
    else {
        const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
        const p = 2 * l - q;
        rr = hue2rgb(p, q, h + 1 / 3);
        gg = hue2rgb(p, q, h);
        bb = hue2rgb(p, q, h - 1 / 3);
    }
    return { r: Math.round(rr * 255), g: Math.round(gg * 255), b: Math.round(bb * 255) };
}

/**
 * C13: keep <meta name="theme-color"> in sync with the active theme's accent.
 * Light/default → #007AFF, dark → #0A84FF. Called from applySettings after each
 * data-theme set (including system-mode OS flips) so the browser chrome matches.
 */
function _updateMetaThemeColor() {
    const meta = document.getElementById('meta-theme-color');
    if (!meta) return;
    const theme = document.documentElement.getAttribute('data-theme') || 'light';
    meta.setAttribute('content', (theme === 'dark') ? '#0A84FF' : '#007AFF');
}

function renderDashboard() {
    // C2: clear any tick timers from the previous render so we don't leak
    // orphaned 1s intervals (see widgetTimers in widgets.js).
    if (typeof clearAllWidgetTimers === 'function') {
        clearAllWidgetTimers();
    }

    dashboardGrid.innerHTML = '';
    state.widgets.forEach(widget => {
        const widgetElement = createWidgetElement(widget);
        dashboardGrid.appendChild(widgetElement);
    });
}

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
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="23 4 23 10 17 10"></polyline><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"></path></svg>
        </button>` : '';

    actions.innerHTML = `
        ${refreshBtnHtml}
        <button class="action-btn action-icon" data-action="edit" title="Edit Widget" aria-label="Edit ${escapeHtml(widget.title)}">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="3"></circle><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"></path></svg>
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
    createWidgetContent(widget, contentContainer);

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

/**
 * Grid-level delegated click handler.
 *
 * One listener on the stable `dashboardGrid` element dispatches to the right
 * handler based on the clicked element's class. Because the grid element is
 * never re-created, re-rendering widget content (or the whole dashboard)
 * cannot stack duplicate handlers.
 */
function handleGridClick(e) {
    const target = e.target;
    const card = target.closest('.widget-card');
    if (!card || !dashboardGrid.contains(card)) return;

    const widgetId = card.dataset.id;
    const widget = state.widgets.find(w => w.id === widgetId);
    if (!widget) return;

    const contentContainer = card.querySelector('.widget-content');

    // Widget action buttons (Edit / Delete).
    // Resolve from any .action-btn ancestor so the click still works when the
    // user hits an inner element of the button (e.g. the gear <svg>) or a text
    // node — this is what made the settings gear unreliable before.
    const actionBtn = target.closest ? target.closest('.action-btn') : null;
    if (actionBtn && card.contains(actionBtn)) {
        handleWidgetAction(widget, actionBtn.dataset.action);
        return;
    }

    // NOTE: "+ Add link" and its toggle no longer live in the card — they moved to
    // this widget's Edit page (see openEditWidgetModal + WidgetRegistry['shortcuts']).
    // The old delegated branches for .shortcut-add-toggle / .add-shortcut-btn were removed.

    // Shortcuts: delete
    if (target.classList.contains('delete-shortcut-btn')) {
        const index = Number(target.dataset.index);
        widget.data = widget.data || {};
        widget.data.items = widget.data.items || [];
        widget.data.items.splice(index, 1);
        saveFullState();
        renderShortcuts(widget, contentContainer);
        return;
    }

    // Lists: add
    if (target.classList.contains('add-list-btn')) {
        const inputEl = contentContainer.querySelector('.list-input');
        const text = inputEl.value.trim();
        if (text) {
            widget.data = widget.data || {};
            widget.data.items = widget.data.items || [];
            widget.data.items.push({ text, completed: false });
            saveFullState();
            renderLists(widget, contentContainer);
        }
        return;
    }

    // Lists: checkbox toggle (the primary complete/un-complete control)
    if (target.classList.contains('list-item-checkbox')) {
        const index = Number(target.dataset.index);
        widget.data = widget.data || {};
        widget.data.items = widget.data.items || [];
        if (widget.data.items[index]) {
            widget.data.items[index].completed = !widget.data.items[index].completed;
            saveFullState();
            renderLists(widget, contentContainer);
        }
        return;
    }

    // NOTE: "Show completed", "Sort by due date" and "Clear completed"
    // are no longer card controls — they live on this widget's Edit page now.

    // Lists: row click → open the inline editor for due date + note.
    // (The checkbox and × buttons are handled above / below; this branch fires only when the user clicks elsewhere on the row.)
    const listItem = target.closest('.list-item');
    if (listItem && card.contains(listItem) && !target.closest('input, textarea, button')) {
        const index = Number(listItem.dataset.index);
        // Close any other open editors in this widget first.
        contentContainer.querySelectorAll('.list-item-editor').forEach(el => { el.hidden = true; });
        const editor = listItem.querySelector(`.list-item-editor[data-index="${index}"]`);
        if (editor) {
            editor.hidden = false;
            const dueInput = editor.querySelector('input.list-due-input');
            if (dueInput) { dueInput.focus(); }
        }
        return;
    }

    // Lists: save the inline editor for an item.
    if (target.classList.contains('list-editor-save')) {
        const li = target.closest('.list-item');
        const index = Number(li && li.dataset.index);
        widget.data = widget.data || {};
        widget.data.items = widget.data.items || [];
        const item = widget.data.items[index];
        if (item) {
            const editor = li.querySelector(`.list-item-editor[data-index="${index}"]`);
            const dueInput = editor && editor.querySelector('input.list-due-input');
            const noteTa  = editor && editor.querySelector('textarea.list-note-input');
            const dv = (dueInput && dueInput.value) ? dueInput.value.trim() : '';
            item.dueDate = (/^\d{4}-\d{2}-\d{2}$/.test(dv)) ? dv : null;
            if (noteTa) {
                const nv = noteTa.value.trim();
                item.note = nv; // empty string clears the note
            }
        }
        saveFullState();
        renderLists(widget, contentContainer);
        return;
    }

    // Lists: cancel the inline editor (revert to saved values).
    if (target.classList.contains('list-editor-cancel')) {
        const li = target.closest('.list-item');
        const index = Number(li && li.dataset.index);
        widget.data = widget.data || {};
        widget.data.items = widget.data.items || [];
        const item = widget.data.items[index];
        if (li) {
            const editor = li.querySelector(`.list-item-editor[data-index="${index}"]`);
            if (editor) {
                const dueInput = editor.querySelector('input.list-due-input');
                if (dueInput && item) {
                    dueInput.value = (/^\d{4}-\d{2}-\d{2}$/.test(item.dueDate || '')) ? item.dueDate : '';
                }
                const noteTa = editor.querySelector('textarea.list-note-input');
                if (noteTa && item) noteTa.value = item.note || '';
            }
        }
        // Just close the editor; no state change.
        renderLists(widget, contentContainer);
        return;
    }

    // Lists: delete
    if (target.classList.contains('delete-list-btn')) {
        const index = Number(target.dataset.index);
        widget.data = widget.data || {};
        widget.data.items = widget.data.items || [];
        widget.data.items.splice(index, 1);
        saveFullState();
        renderLists(widget, contentContainer);
        return;
    }

    // Clock rows no longer have a per-row delete button; times are managed on the Edit page.

    // Perplexity: search (uses the configured engine via buildSearchUrl)
    if (target.classList.contains('search-btn')) {
        const inputEl = contentContainer.querySelector('.search-input');
        const query = inputEl.value.trim();
        if (query) {
            runPerplexitySearch(widget, query);
        }
        return;
    }

    // Perplexity: click a recent-query chip → fill the input and search.
    if (target.classList.contains('recent-chip')) {
        const q = target.dataset.q || '';
        if (!q) return;
        const inputEl = contentContainer.querySelector('.search-input');
        if (inputEl) inputEl.value = q;
        runPerplexitySearch(widget, q);
        return;
    }
}

// ── Delegated input / change handlers for live-updating controls ────────────

/** Live-filter shortcut items as the user types. Hides non-matching rows without a full re-render. */
function handleGridInput(e) {
    const target = e.target;
    if (!target.classList || !target.classList.contains('shortcut-filter')) return;

    const card = target.closest('.widget-card');
    if (!card || !dashboardGrid.contains(card)) return;
    const widgetId = card.dataset.id;
    const query = (target.value || '').trim().toLowerCase();

    // Each .shortcut-item-container holds one link row; hide rows that don't match.
    card.querySelectorAll('.shortcuts-list > .shortcut-item-container').forEach(row => {
        if (!query) { row.hidden = false; return; }
        const labelEl = row.querySelector('.shortcut-label');
        const descEl  = row.querySelector('.shortcut-desc');
        const a       = row.querySelector('a.shortcut-item');
        const haystack = [
            (labelEl && labelEl.textContent) || '',
            (descEl  && descEl.textContent)  || '',
            (a       && a.href)              || ''
        ].join(' ').toLowerCase();
        row.hidden = !haystack.includes(query);
    });
}

/** Handle change events for selects that need a re-render (sort order, engine). */
function handleGridChange(e) {
    const target = e.target;

    // Perplexity: inline engine selector → persist + re-render.
    if (target.classList && target.classList.contains('engine-select')) {
        const card = target.closest('.widget-card');
        if (!card || !dashboardGrid.contains(card)) return;
        const widget = state.widgets.find(w => w.id === card.dataset.id);
        if (!widget) return;
        widget.config = widget.config || {};
        widget.config.engine = target.value;
        saveFullState();
        renderPerplexity(widget, card.querySelector('.widget-content'));
        return;
    }

    // Shortcuts: sort-order select → re-render with the chosen order.
    if (!target.classList || !target.classList.contains('shortcut-sort')) return;

    const card = target.closest('.widget-card');
    if (!card || !dashboardGrid.contains(card)) return;
    const widgetId = card.dataset.id;
    const widget = state.widgets.find(w => w.id === widgetId);
    if (!widget) return;
    const contentContainer = card.querySelector('.widget-content');

    // Persist the chosen display order; renderShortcuts handles the actual sorting.
    widget.config = widget.config || {};
    widget.config.sortOrder = target.value; // 'manual' | 'frequent'

    saveFullState();
    renderShortcuts(widget, contentContainer);
}

/**
 * Grid-level delegated keypress handler (Enter key in list or search inputs).
 */

function handleGridKeypress(e) {
    // Inline list editor: Enter saves; Esc cancels.
    if (e.target.classList && (e.target.classList.contains('list-due-input') || e.target.classList.contains('list-note-input'))) {
        const card = e.target.closest('.widget-card');
        if (!card) return;
        const widget = state.widgets.find(w => w.id === card.dataset.id);
        if (!widget) return;
        const contentContainer = card.querySelector('.widget-content');

        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            // Trigger the same save path as clicking Save.
            const li = e.target.closest('.list-item');
            const saveBtn = li && li.querySelector('.list-editor-save');
            if (saveBtn) saveBtn.click();
        } else if (e.key === 'Escape') {
            e.preventDefault();
            const li = e.target.closest('.list-item');
            const cancelBtn = li && li.querySelector('.list-editor-cancel');
            if (cancelBtn) cancelBtn.click();
        }
        return;
    }

    if (e.key !== 'Enter') return;

    const isListInput = e.target.classList.contains('list-input');
    const isSearchInput = e.target.classList.contains('search-input');
    if (!isListInput && !isSearchInput) return;

    // The search box is now a <textarea>: plain Enter runs the search,
    // Shift+Enter inserts a newline so users can compose multi-line queries.
    if (isSearchInput && e.shiftKey) return; // let the browser insert the newline

    e.preventDefault();

    const card = e.target.closest('.widget-card');
    if (!card || !dashboardGrid.contains(card)) return;

    const widget = state.widgets.find(w => w.id === card.dataset.id);
    if (!widget) return;

    const contentContainer = card.querySelector('.widget-content');

    if (isListInput) {
        const text = e.target.value.trim();
        if (!text) return;
        widget.data = widget.data || {};
        widget.data.items = widget.data.items || [];
        widget.data.items.push({ text, completed: false });
        saveFullState();
        renderLists(widget, contentContainer);
    } else {
        // Perplexity search (Enter in the query box)
        const query = e.target.value.trim();
        if (!query) return;
        runPerplexitySearch(widget, query);
    }
}

/**
 * Global keyboard shortcuts. "\" focuses the first Perplexity search box; Alt+P is an
 * unambiguous alternative. Both are suppressed while the user is typing in any field,
 * when a modal is open, or when focus is already inside that same input.
 */
function handleGlobalShortcuts(e) {
    // Don't hijack keys from inputs / textareas / contenteditable (except Escape).
    const t = e.target;
    const typingInField = t && (
        t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' ||
        t.isContentEditable
    );

    // Alt+P works even while in a field? No — keep it simple: only when not typing.
    if (typingInField) return;

    const modalOpen = !modalContainer.hidden;
    if (modalOpen) return; // don't steal focus from an open dialog

    let shouldFocus = false;
    if ((e.key === '/' && !e.ctrlKey && !e.metaKey && !e.altKey)) {
        shouldFocus = true;
    } else if (e.altKey && (e.key === 'p' || e.key === 'P')) {
        shouldFocus = true;
    }

    if (!shouldFocus) return;

    const inputEl = dashboardGrid.querySelector('.search-input');
    if (!inputEl) return; // no Perplexity widget present

    e.preventDefault();
    inputEl.focus();
    inputEl.select && inputEl.select();
}

/**
 * Run a Perplexity-style search: build the URL from the widget's configured engine,
 * record it in recent queries (local), and open it. Shared by the Search button,
 * Enter key, and recent-query chips.
 */
function runPerplexitySearch(widget, query) {
    const config = widget.config || {};
    const engine = ['perplexity', 'google', 'bing', 'ddg'].includes(config.engine) ? config.engine : 'perplexity';

    // Record the query locally (dedupe, cap at 10).
    widget.data = widget.data || {};
    if (!Array.isArray(widget.data.recentQueries)) widget.data.recentQueries = [];
    const rq = widget.data.recentQueries;
    const idx = rq.findIndex(q => q.toLowerCase() === query.toLowerCase());
    if (idx !== -1) rq.splice(idx, 1);
    rq.unshift(query);
    while (rq.length > 10) rq.pop();

    // Open the result in a new tab by default.
    const url = buildSearchUrl(engine, query);
    window.open(url, config.openInNewTab !== false ? '_blank' : '_self', 'noopener,noreferrer');

    saveFullState();
    // Re-render so the recent-queries chips update immediately.
    const card = dashboardGrid.querySelector(`.widget-card[data-id="${widget.id}"]`);
    if (card) {
        const cc = card.querySelector('.widget-content');
        renderPerplexity(widget, cc);
    }
}

/**
 * Widget Actions
 */
function handleWidgetAction(widget, action) {
    switch (action) {
        case 'edit':
            openEditWidgetModal(widget);
            break;
        case 'refresh':
            // T12: header ↻ icon — call the widget's exposed refresh fn.
            if (widget.type === 'weather' && typeof widget.__weatherRefresh === 'function') {
                widget.__weatherRefresh();
            } else if (widget.type === 'stocks' && typeof widget.__stocksRefresh === 'function') {
                widget.__stocksRefresh();
            }
            break;
        // Note: the card-header Delete button was removed; deletion now happens
        // from the Edit page's danger zone (#edit-delete).
    }
}

window.saveFullState = function() {
    Storage.saveData(window.state);
};

/**
 * Drag and Drop reordering
 *
 * Cards are grabbed by the grip handle in their header. While dragging, a
 * dashed drop indicator shows the slot the card will land in. Dropping into
 * empty grid area moves the card to the end of the dashboard.
 */
let draggingCard = null;
let dropIndicator = null;
let indicatorTarget = null;    // card the indicator sits before/after (null = end of grid)
let indicatorPosition = null;  // 'before' | 'after' | 'end'

function handleDragStart(e, card) {
    draggingCard = card;
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', card.dataset.id);
    // Defer the class so the browser captures the drag image before styling changes.
    requestAnimationFrame(() => card.classList.add('dragging'));
}

function handleDragEnd(e, card) {
    card.classList.remove('dragging');
    card.draggable = false;
    if (draggingCard === card) draggingCard = null;
    clearDropIndicator();
}

function handleDragOver(e, card) {
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = 'move';
    if (card === draggingCard) return;
    showDropIndicator(card, getDropPosition(e, card));
}

function handleDrop(e, card) {
    e.preventDefault();
    e.stopPropagation();
    const draggedId = draggingCard ? draggingCard.dataset.id : null;
    clearDropIndicator();
    if (!draggedId || card === draggingCard) return;
    commitReorder(draggedId, card.dataset.id, getDropPosition(e, card));
}

/**
 * Decide whether the pointer is in the "before" or "after" half of the target card.
 * Uses the dominant axis: side-by-side cards split left/right, stacked cards split top/bottom.
 */
function getDropPosition(e, card) {
    const rect = card.getBoundingClientRect();
    const vOverlap = Math.min(rect.bottom, e.clientY) - Math.max(rect.top, e.clientY);
    const hOverlap = Math.min(rect.right, e.clientX) - Math.max(rect.left, e.clientX);
    if (hOverlap > vOverlap) {
        return e.clientX < rect.left + rect.width / 2 ? 'before' : 'after';
    }
    return e.clientY < rect.top + rect.height / 2 ? 'before' : 'after';
}

function ensureDropIndicator() {
    if (!dropIndicator) {
        dropIndicator = document.createElement('div');
        dropIndicator.className = 'drop-indicator';
        dropIndicator.setAttribute('aria-hidden', 'true');
    }
    return dropIndicator;
}

function showDropIndicator(card, position) {
    if (indicatorTarget === card && indicatorPosition === position) return;
    clearDropIndicator();
    const indicator = ensureDropIndicator();
    if (position === 'before') card.before(indicator);
    else card.after(indicator);
    indicatorTarget = card;
    indicatorPosition = position;
}

function showDropIndicatorAtEnd() {
    if (indicatorTarget === null && indicatorPosition === 'end') return;
    clearDropIndicator();
    dashboardGrid.appendChild(ensureDropIndicator());
    indicatorTarget = null;
    indicatorPosition = 'end';
}

function clearDropIndicator() {
    if (dropIndicator && dropIndicator.parentNode) dropIndicator.remove();
    indicatorTarget = null;
    indicatorPosition = null;
}

/**
 * Grid-level handlers: dropping outside any card (gaps or empty space) lands at the end.
 */
function handleGridDragOver(e) {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    if (dropIndicator && e.target === dropIndicator) return; // already showing a slot
    showDropIndicatorAtEnd();
}

function handleGridDragLeave(e) {
    if (!dashboardGrid.contains(e.relatedTarget)) clearDropIndicator();
}

function handleGridDrop(e) {
    e.preventDefault();
    if (!draggingCard) return;
    const draggedId = draggingCard.dataset.id;

    if (dropIndicator && e.target === dropIndicator && dropIndicator.parentNode) {
        // Dropped onto the indicator slot: land before the next card, or at the end.
        let sibling = dropIndicator.nextElementSibling;
        while (sibling && !sibling.classList.contains('widget-card')) {
            sibling = sibling.nextElementSibling;
        }
        clearDropIndicator();
        if (sibling) commitReorder(draggedId, sibling.dataset.id, 'before');
        else commitReorderToEnd(draggedId);
        return;
    }

    clearDropIndicator();
    commitReorderToEnd(draggedId);
}

/**
 * Commit reorders and persist state.
 */
function commitReorder(draggedId, targetId, position) {
    if (draggedId === targetId) return;
    const fromIndex = state.widgets.findIndex(w => w.id === draggedId);
    if (fromIndex === -1) return;

    const item = state.widgets.splice(fromIndex, 1)[0];
    let toIndex = state.widgets.findIndex(w => w.id === targetId);
    if (toIndex === -1) toIndex = 0;
    if (position === 'after') toIndex += 1;
    state.widgets.splice(toIndex, 0, item);

    persistReorder();
}

function commitReorderToEnd(draggedId) {
    const fromIndex = state.widgets.findIndex(w => w.id === draggedId);
    if (fromIndex === -1) return;
    const item = state.widgets.splice(fromIndex, 1)[0];
    state.widgets.push(item);
    persistReorder();
}

function persistReorder() {
    // Keep the position fields in sync with array order.
    state.widgets.forEach((w, i) => { w.position = i; });
    Storage.saveData(state);
    renderDashboard();
}

/**
 * Keyboard reordering for the drag handle (arrow keys), used as the
 * accessible replacement for the removed up/down buttons.
 */
function reorderWidgetByOffset(id, direction) {
    const index = state.widgets.findIndex(w => w.id === id);
    if (index === -1) return;

    const newIndex = index + direction;
    if (newIndex < 0 || newIndex >= state.widgets.length) return;

    const item = state.widgets.splice(index, 1)[0];
    state.widgets.splice(newIndex, 0, item);
    persistReorder();

    // Keep focus on the handle so arrow keys can be pressed repeatedly.
    const card = dashboardGrid.querySelector(`.widget-card[data-id="${id}"]`);
    const handle = card && card.querySelector('.widget-drag-handle');
    if (handle) handle.focus();
}

/**
 * Modals
 */
function openAddWidgetModal() {
    // Build the widget-type buttons from the registry so new types appear
    // automatically without editing this function.
    // C7: each button now carries an optional hint from registry metadata, rendered
    // as a small caption below the label. New types that set `hint` get it for free.
    const typeButtons = Object.keys(WidgetRegistry).map(type => {
        const entry = WidgetRegistry[type];
        const hint = (entry && typeof entry.hint === 'string') ? `<span class="widget-type-hint">${escapeHtml(entry.hint)}</span>` : '';
        return `<button data-type="${type}"><span class="widget-type-label">${escapeHtml(entry.label)}</span>${hint}</button>`;
    }).join('');

    modalBody.innerHTML = `
        <h3 style="margin-top:0;">Add New Widget</h3>
        <p>Select a widget type to add to your dashboard:</p>
        <div class="widget-options">
            ${typeButtons}
        </div>
    `;
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
    // Build type-specific edit fields from the registry entry when available.
    const entry = WidgetRegistry[widget.type];
    const isClock = widget.type === 'clock';

    let fieldsHtml = '';

    if (entry && typeof entry.editFields === 'function') {
        // Registry-driven: lets new types define their own edit UI.
        try { fieldsHtml = entry.editFields(widget); } catch(e) { console.warn('editFields failed', e); }
    // C3: type id renamed from 'perplexity' → 'search'.
    } else if (widget.type === 'search') {
        const cfg = widget.config || {};
        // T17: the shared #edit-widget-title above is now the single Title field.
        fieldsHtml = `
            <div class="settings-group">
                <label class="checkbox-label">
                    <input type="checkbox" id="edit-open-tab" ${cfg.openInNewTab !== false ? 'checked' : ''}> Open results in new tab
                </label>
            </div>
        `;
    } else if (isClock) {
        const cfg = widget.config || {};
        fieldsHtml = `
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
        `;
    }

    // Note: the clock's time-entry editor comes from the registry entry's editFields()
    // above, so we must NOT render a second one here (that was duplicating the list).
    const timesHtml = '';

    // Size selector (span 1/2/3) — available for every widget type.
    const currentSpan = [1, 2, 3].includes(widget.span) ? widget.span : 1;
    const spanHtml = `
        <div class="settings-group">
            <label>Size:</label>
            <select id="edit-widget-span">
                <option value="1" ${currentSpan === 1 ? 'selected' : ''}>Small (1 column)</option>
                <option value="2" ${currentSpan === 2 ? 'selected' : ''}>Medium (2 columns)</option>
                <option value="3" ${currentSpan === 3 ? 'selected' : ''}>Large (3 columns)</option>
            </select>
        </div>
    `;

    // T22: per-widget icon — a shared dropdown of Material-style glyphs, shown next
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
    const currentIcon = (typeof widget.icon === 'string') ? widget.icon : '';
    const iconOptions = WIDGET_ICONS.map(ic => {
        // If the stored icon isn't in our curated list, offer it as a custom option.
        return `<option value="${escapeHtml(ic.v)}" ${ic.v === currentIcon ? 'selected' : ''}>${escapeHtml(ic.label)}</option>`;
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
    const currentFill = /^#[0-9a-fA-F]{6}$/.test(widget.fillColor || '') ? widget.fillColor : '';
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
                    ${currentFill ? 'Preview' : 'No fill (theme default)'}
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
    modalContainer.hidden = false;
    _focusIntoModal();

    // ── Live fill-color preview swatch ────────────────────────────────────────
    const fillInput   = document.getElementById('edit-widget-fill');
    const opacityEl   = document.getElementById('edit-widget-fill-opacity');
    const swatch      = document.getElementById('fill-preview-swatch');

    function _updateFillPreview() {
        if (!swatch) return;
        const hex  = fillInput ? (fillInput.value || '').trim() : '';
        const pct  = opacityEl ? parseInt(opacityEl.value, 10) / 100 : 1;
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
                if (!Storage.isValidHttpUrl(url)) {
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
                if (card) renderShortcuts(widget, card.querySelector('.widget-content'));

                // Clear the form for another entry; keep focus on the label field.
                if (labelEl) { labelEl.value = ''; }
                if (urlEl)   { urlEl.value = ''; }
                if (descEl)  { descEl.value = ''; }
                if (labelEl) labelEl.focus();
            });
        }
    }

    // Wire up the clock times editor (only present for clock widgets).
    if (isClock) {
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
     * tickers, countdown events, RSS feeds, currency codes, habits). Each widget
     * supplies its own DOM specifics; the add/remove behavior is implemented once.
     *
     * Convention: existing rows render `<type>-remove-entry` and new rows added in-session
     * use the same class (see each config below), so removal works identically for both —
     * this makes the B2-style "saved row's × does nothing" bug structurally impossible.
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
            const row = document.createElement('div');
            row.innerHTML = newRowHtml;
            // innerHTML may produce a single element or text+element; append the node(s).
            Array.from(row.childNodes).forEach(n => editor.appendChild(n));
            const focusEl = focusSelector ? editor.querySelector(focusSelector) : null;
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

    // T7: Wire up the Habit Tracker row editor (add/remove habits).
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

    // Wire up the RSS feeds editor (only present for rss widgets).
    if (widget.type === 'rss') {
        wireRowEditor({
            editorId: 'rss-feeds-editor',
            addBtnId: 'rss-add-feed',
            focusSelector: '.rss-feed-url',
            newRowHtml: `
                <div class="rss-feed-row">
                    <input type="text" class="rss-feed-label" placeholder="Label (optional)">
                    <input type="url" class="rss-feed-url" placeholder="Feed URL (https://…/feed.xml)">
                    <button type="button" class="rss-remove-entry" title="Remove feed">×</button>
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

        // T22: persist the per-widget icon glyph ('' = none).
        const iconEl = document.getElementById('edit-widget-icon');
        if (iconEl) {
            const v = iconEl.value.trim();
            if (v) widget.icon = v; else delete widget.icon;
        }

        // Persist fill color (or clear it).
        const clearedFlag = typeof widget.__fillClearedFlag === 'function' ? widget.__fillClearedFlag() : false;
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

        // Ensure config exists before writing to it (covers perplexity + clock branches).
        widget.config = widget.config || {};

        // Lists / Todo — persist the display options moved here from the card.
        if (widget.type === 'lists') {
            const showEl = document.getElementById('edit-lists-show-completed');
            if (showEl) { widget.data = widget.data || {}; widget.data.showCompleted = showEl.checked; }
            const sortEl = document.getElementById('edit-lists-sort-due');
            if (sortEl) { widget.data = widget.data || {}; widget.data.sortByDueDate = sortEl.checked; }
        }

        // C3: type id renamed from 'perplexity' → 'search'.
        if (widget.type === 'search') {
            // T17: title comes from the shared #edit-widget-title field now.
            const openTabEl = document.getElementById('edit-open-tab');
            if (openTabEl) widget.config.openInNewTab = openTabEl.checked;
        }

        if (isClock) {
            widget.config.formatType = parseInt(document.getElementById('edit-clock-format').value, 10);
            widget.config.showSeconds = document.getElementById('edit-clock-seconds').checked;
            widget.config.showDate = document.getElementById('edit-clock-date').checked;

            const times = [];
            modalBody.querySelectorAll('.clock-time-row').forEach(row => {
                const label = row.querySelector('.clock-time-label').value.trim();
                const tz = row.querySelector('.clock-time-zone').value.trim();
                if (tz) times.push({ label, timezone: tz });
            });
            widget.data = widget.data || {};
            widget.data.times = times;
        }

        // Weather — persist city / lat / lon / units / forecast toggle.
        if (widget.type === 'weather') {
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
        }

        // Stocks — persist the edited ticker list.
        if (widget.type === 'stocks') {
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
        }

        // Countdown — persist the edited event list (label + when).
        if (widget.type === 'countdown') {
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
        }

        // T7: Habit Tracker — persist the edited habit list. The log is
        // managed by the widget itself and untouched here.
        if (widget.type === 'habits') {
            widget.data = widget.data || {};
            const habits = [];
            modalBody.querySelectorAll('.habit-row-editor').forEach(row => {
                const labelEl = row.querySelector('.habit-label-input');
                if (!labelEl) return;
                const label = (labelEl.value || '').trim();
                if (!label) return; // skip blank rows
                habits.push({ id: 'habit-' + Date.now() + '-' + Math.random().toString(36).slice(2, 7), label });
            });
            widget.data.habits = habits;
        }

        // T7: Currency Converter — persist base currency + the list of foreign codes.
        if (widget.type === 'currency') {
            widget.config = widget.config || {};
            const fromEl = document.getElementById('currency-from-code');
            if (fromEl) {
                const f = String(fromEl.value).trim().toUpperCase();
                if (/^[A-Z]{3}$/.test(f)) widget.config.from = f; else widget.config.from = 'USD';
            }
            // Read the multi-currency rows into config.toCodes (de-duped, base excluded).
            const codes = [];
            const seenC = new Set();
            modalBody.querySelectorAll('.currency-code-input').forEach(inp => {
                const c = String(inp.value).trim().toUpperCase();
                if (/^[A-Z]{3}$/.test(c) && c !== widget.config.from && !seenC.has(c)) { codes.push(c); seenC.add(c); }
            });
            widget.config.toCodes = codes.length ? codes : ['EUR', 'GBP'];
        }

        // T7: Pomodoro — persist duration settings. The running timer state
        // (mode / remainingSec) is managed by the widget itself and untouched here.
        if (widget.type === 'pomodoro') {
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
        }

        // RSS — persist the edited feed list (optional label + url).
        if (widget.type === 'rss') {
            widget.data = widget.data || {};
            const feeds = [];
            modalBody.querySelectorAll('.rss-feed-row').forEach(row => {
                const labelEl = row.querySelector('.rss-feed-label');
                const urlEl   = row.querySelector('.rss-feed-url');
                if (!urlEl) return;
                let url = (urlEl.value || '').trim();
                if (!url) return; // skip rows without a URL
                if (!/^https?:\/\//i.test(url)) url = 'https://' + url;
                if (!Storage.isValidHttpUrl(url)) {
                    window.alert('Invalid feed URL: "' + url + '" (must be http/https).');
                    return;
                }
                feeds.push({ label: (labelEl && labelEl.value.trim()) || '', url, maxItems: 8 });
            });
            widget.data.feeds = feeds;
        }

        window.saveFullState();
        renderDashboard();
        closeModal();
    });

    // Lists / Todo — "Clear completed" action now lives on the Edit page.
    const clearCompletedBtn = document.getElementById('edit-lists-clear-completed');
    if (clearCompletedBtn) {
        clearCompletedBtn.addEventListener('click', () => {
            widget.data = widget.data || {};
            widget.data.items = widget.data.items || [];
            const before = widget.data.items.length;
            // Snapshot the completed items we're about to remove so Undo can restore them.
            const removedItems = widget.data.items.filter(i => i.completed);
            if (removedItems.length === 0) { alert('There are no completed items to clear.'); return; }

            widget.data.items = widget.data.items.filter(i => !i.completed);
            saveFullState();
            renderDashboard();
            closeModal();

            // Undo: put the removed items back at their original positions.
            showUndoToast(`Cleared ${removedItems.length} completed item${removedItems.length === 1 ? '' : 's'}`, () => {
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
            clearClockTimer(widget.id);
            clearCountdownTimer(widget.id);
            if (typeof clearPomodoroTimer === 'function') clearPomodoroTimer(widget.id); // T7
            renderDashboard();
            closeModal();

            // Undo: re-insert at the same index (or end if out of range) and restore timers.
            const label = `Deleted ${widget.title}`;
            showUndoToast(label, () => {
                const clone = JSON.parse(JSON.stringify(snapshot));
                state.widgets.splice(Math.min(indexInArray, state.widgets.length), 0, clone);
                saveFullState();
                renderDashboard();
                // Re-register any tick timers the widget needs (clock / countdown).
                if (clone.type === 'clock') {
                    const card = dashboardGrid.querySelector(`.widget-card[data-id="${CSS.escape(clone.id)}"]`);
                    if (card) { clearClockTimer(clone.id); renderClock(clone, card.querySelector('.widget-content')); }
                } else if (clone.type === 'countdown') {
                    const card = dashboardGrid.querySelector(`.widget-card[data-id="${CSS.escape(clone.id)}"]`);
                    if (card) { clearCountdownTimer(clone.id); renderCountdown(clone, card.querySelector('.widget-content')); }
                } else if (clone.type === 'pomodoro') {
                    // T7: Pomodoro resumes from persisted state on re-render.
                    const card = dashboardGrid.querySelector(`.widget-card[data-id="${CSS.escape(clone.id)}"]`);
                    if (card) { clearPomodoroTimer(clone.id); renderPomodoro(clone, card.querySelector('.widget-content')); }
                }
            });
        });
    }
}

/**
 * NOTE: the clock's time-entry editor is defined once, in WidgetRegistry['clock'].editFields()
 * (registry.js). It used to also exist here as buildClockTimesEditor(), which was a duplicate
 * source of truth and could render the existing clocks twice. Removed — keep only the registry copy.
 */

/**
 * Small helper to escape HTML for safe insertion into innerHTML.
 */
function escapeHtml(value) {
    return String(value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

function openSettingsModal() {
    const dashTitle = (state.settings.dashboardTitle && state.settings.dashboardTitle.trim()) ? state.settings.dashboardTitle : 'My Dashboard';

    modalBody.innerHTML = `
        <h3 style="margin-top:0;">Settings</h3>
        <div class="settings-group">
            <label>Dashboard title:</label>
            <input type="text" id="dashboard-title-input" value="${escapeHtml(dashTitle)}" placeholder="My Dashboard">
            <p style="font-size:10px;margin-top:4px;opacity:.7;">Shown in the header. Leave blank to use “My Dashboard”.</p>
        </div>
        <div class="settings-group">
            <label>Theme:</label>
            <select id="theme-select">
                <option value="system" ${state.settings.theme === 'system' ? 'selected' : ''}>System</option>
                <option value="light"  ${state.settings.theme === 'light'  ? 'selected' : ''}>Light</option>
                <option value="dark"   ${state.settings.theme === 'dark'   ? 'selected' : ''}>Dark</option>
            </select>
        </div>

        <!-- T18: Layout — grid columns + global UI scale (zoom) -->
        <h3 style="margin:8px 0 4px;">Layout &amp; Size</h3>
        <div class="settings-group">
            <label>Columns:</label>
            <select id="layout-columns">
                <option value="auto" ${(!state.settings.gridColumns) ? 'selected' : ''}>Auto (fit to width)</option>
                <option value="3"  ${state.settings.gridColumns === 3 ? 'selected' : ''}>3 columns</option>
                <option value="4"  ${state.settings.gridColumns === 4 ? 'selected' : ''}>4 columns</option>
                <option value="5"  ${state.settings.gridColumns === 5 ? 'selected' : ''}>5 columns</option>
                <option value="6"  ${state.settings.gridColumns === 6 ? 'selected' : ''}>6 columns</option>
            </select>
            <p style="font-size:10px;margin-top:4px;opacity:.7;">How many widget columns to show. “Auto” fits as many as the width allows.</p>
        </div>
        <div class="settings-group">
            <label>UI size / zoom:</label>
            <input type="range" id="ui-scale" min="75" max="125" step="5"
                   value="${state.settings.uiScale != null ? state.settings.uiScale : 100}"
                   aria-label="Dashboard UI scale">
            <p style="font-size:10px;margin-top:4px;opacity:.7;">Scales the whole dashboard (like browser zoom, but saved). ${state.settings.uiScale != null ? Math.round(state.settings.uiScale) : 100}%</p>
        </div>
        <!-- T13: Header (title bar) appearance -->
        <h3 style="margin:8px 0 4px;">Header / Title Bar</h3>
        <div class="settings-group">
            <label>Header background color:</label>
            <div style="display:flex;align-items:center;gap:10px;margin-top:4px;">
                <input type="color" id="header-bg-color"
                       value="${state.settings.headerBgColor || '#2a2a3e'}"
                       aria-label="Header background color"
                       style="width:48px;height:36px;border:none;padding:0;cursor:pointer;background:none;">
                <span id="header-bg-color-hint" style="font-size:12px;opacity:.7;">
                    ${state.settings.headerBgColor ? state.settings.headerBgColor : 'Theme default'}
                </span>
            </div>
            <button type="button" id="header-bg-clear" style="margin-top:6px;">Use theme default</button>
        </div>
        <div class="settings-group">
            <label>Header opacity:</label>
            <input type="range" id="header-opacity" min="10" max="100" step="5"
                   value="${Math.round((state.settings.headerOpacity != null ? state.settings.headerOpacity : 0.9) * 100)}"
                   aria-label="Header opacity">
        </div>

        <hr style="margin:8px 0;">
        <h3 style="margin:4px 0 8px;">Background</h3>
        <div class="settings-group">
            <label>Background Image URL:</label>
            <input type="text" id="bg-url" value="${state.settings.background.imageUrl || ''}">
        </div>
        <div class="settings-group">
            <label>Upload Background:</label>
            <input type="file" id="bg-upload" accept="image/*">
            <p style="font-size: 10px; margin-top: 5px; opacity: 0.7;">Note: Large images may exceed localStorage limits.</p>
        </div>
        <div class="settings-group">
            <label>Overlay Opacity:</label>
            <input type="range" id="bg-opacity" min="0" max="1" step="0.1" value="${state.settings.background.overlayOpacity}">
        </div>
        <div class="settings-group">
            <label>Blur:</label>
            <input type="range" id="bg-blur" min="0" max="20" step="1" value="${state.settings.background.blurPx}">
        </div>
        <div class="settings-group">
            <label>CORS Proxy URL (RSS feeds, optional):</label>
            <input type="text" id="cors-proxy-url" placeholder="e.g. https://myproxy.example.com/proxy?url={url}" value="${escapeHtml(state.settings.corsProxyUrl || '')}">
            <p style="font-size:10px;opacity:.7;margin-top:4px;">Browsers block cross-origin RSS feeds (CORS). Public proxies are often down. If you have a working proxy endpoint, paste it here — use the placeholder <code>{url}</code> where the feed URL should go. Leave blank to rely on built-in public proxies only.</p>
        </div>
        <hr>
        <h3 style="margin:8px 0 4px;">Stocks &amp; APIs</h3>
        <div class="settings-group">
            <label>Twelve Data API Key (Stock Watchlist):</label>
            <input type="password" id="twelvedata-key" placeholder="Your Twelve Data key" value="${escapeHtml(state.settings.twelvedataApiKey || '')}" autocomplete="off">
            <p style="font-size:10px;opacity:.7;margin-top:4px;">Stored locally only. Get a free key at twelvedata.com.</p>
        </div>
        <div class="settings-group">
            <label>Stock link URL template:</label>
            <input type="text" id="stock-link-template" placeholder="https://www.google.com/finance/beta/quote/{ticker}" value="${escapeHtml(state.settings.stockLinkTemplate || '')}">
            <p style="font-size:10px;opacity:.7;margin-top:4px;">Use <code>{ticker}</code> where the stock symbol should go. Clicking a stock name opens this URL in a new tab. Leave blank for default (Google Finance).</p>
        </div>
        <button id="save-settings">Save Settings</button>
        <button id="export-data">Export JSON</button>
        <button id="import-data">Import JSON</button>
        <button id="reset-data" style="color: red;">Reset Dashboard</button>
    `;
    modalContainer.hidden = false;
    _focusIntoModal();

    // ── T13: Header color live preview + "Use theme default" ────────────────
    const headerColorInput = document.getElementById('header-bg-color');
    const headerOpacityInput = document.getElementById('header-opacity');
    const headerHint = document.getElementById('header-bg-color-hint');

    function _applyHeaderPreview() {
        if (!headerColorInput) return;
        const rgb = hexToRgb(headerColorInput.value || '');
        if (rgb) {
            const op = headerOpacityInput ? parseInt(headerOpacityInput.value, 10) / 100 : 0.9;
            document.querySelector('header').style.background = rgbaString(rgb.r, rgb.g, rgb.b, op);
        }
    }

    if (headerColorInput && headerOpacityInput) {
        headerColorInput.addEventListener('input', _applyHeaderPreview);
        headerOpacityInput.addEventListener('input', _applyHeaderPreview);
    }

    const headerClearBtn = document.getElementById('header-bg-clear');
    let headerCleared = false;
    if (headerClearBtn) {
        headerClearBtn.addEventListener('click', () => {
            headerCleared = true;
            // Reset visual preview to theme default.
            document.querySelector('header').style.background = '';
            if (headerHint) headerHint.textContent = 'Theme default';
        });
    }

    // ────────────────────────────────────────────────────────────────────────

    document.getElementById('save-settings').addEventListener('click', () => {
        const titleInput = document.getElementById('dashboard-title-input');
        if (titleInput) state.settings.dashboardTitle = titleInput.value.trim();
        state.settings.theme = document.getElementById('theme-select').value;

        // T18: Layout — grid columns + UI scale.
        const colsEl = document.getElementById('layout-columns');
        if (colsEl) {
            const v = colsEl.value;
            state.settings.gridColumns = (v === 'auto') ? null : parseInt(v, 10);
        }
        const uiScaleEl = document.getElementById('ui-scale');
        if (uiScaleEl) {
            let s = parseInt(uiScaleEl.value, 10);
            if (!Number.isFinite(s)) s = 100;
            state.settings.uiScale = Math.min(200, Math.max(50, s));
        }

        state.settings.twelvedataApiKey = (document.getElementById('twelvedata-key') ? document.getElementById('twelvedata-key').value : '').trim();
        state.settings.corsProxyUrl = (document.getElementById('cors-proxy-url') ? document.getElementById('cors-proxy-url').value : '').trim();
        // T14: Stock link URL template.
        const stockLinkEl = document.getElementById('stock-link-template');
        if (stockLinkEl) {
            const tmpl = stockLinkEl.value.trim();
            state.settings.stockLinkTemplate = tmpl || null;
        }
        const bgUrlVal = (document.getElementById('bg-url').value || '').trim();
        state.settings.background.imageUrl = bgUrlVal || null;
        // Set type to 'url' when a URL is provided so applySettings() knows which branch to take.
        // If the user clears the URL, revert to 'none' (unless an upload is active).
        if (bgUrlVal) {
            state.settings.background.type = 'url';
        } else if (state.settings.background.type === 'url') {
            state.settings.background.type = 'none';
        }
        state.settings.background.overlayOpacity = parseFloat(document.getElementById('bg-opacity').value);
        state.settings.background.blurPx = parseInt(document.getElementById('bg-blur').value);

        // T13: Header background color + opacity.
        if (headerCleared) {
            delete state.settings.headerBgColor;
        } else {
            const hHexEl = document.getElementById('header-bg-color');
            if (hHexEl && /^#[0-9a-fA-F]{6}$/.test(hHexEl.value)) {
                state.settings.headerBgColor = hHexEl.value;
            }
        }
        const hOpEl = document.getElementById('header-opacity');
        if (hOpEl) state.settings.headerOpacity = parseInt(hOpEl.value, 10) / 100;

        Storage.saveData(state);
        applySettings();
        if (typeof announceStatus === 'function') announceStatus('Settings saved.');
        closeModal();
    });

    // Live preview: blur slider updates the CSS var immediately so the user
    // sees the effect before hitting Save (pairs with the #4 fix).
    const bgBlurInput = document.getElementById('bg-blur');
    if (bgBlurInput) {
        bgBlurInput.addEventListener('input', (e) => {
            document.documentElement.style.setProperty('--blur-amount', `${e.target.value}px`);
        });
    }

    // T18: live preview for the UI scale slider + columns select.
    const uiScalePreview = document.getElementById('ui-scale');
    if (uiScalePreview) {
        uiScalePreview.addEventListener('input', (e) => {
            const pct = parseInt(e.target.value, 10);
            _applyUiScale(pct); // defined in applySettings scope; safe global helper below
            const hint = e.target.parentElement.querySelector('p');
            if (hint) hint.textContent = `Scales the whole dashboard (like browser zoom, but saved). ${pct}%`;
        });
    }
    const colsPreview = document.getElementById('layout-columns');
    if (colsPreview) {
        colsPreview.addEventListener('change', () => { _applyGridColumns(colsPreview.value); });
    }

    document.getElementById('export-data').addEventListener('click', () => Storage.exportData());
    document.getElementById('reset-data').addEventListener('click', () => {
        if (!confirm('Are you sure you want to reset the dashboard? You can undo this from the toast that appears after.')) return;

        // Snapshot BEFORE we wipe, so Undo can restore everything.
        const snapshot = JSON.parse(JSON.stringify(state));

        Storage.reset();            // removes localStorage key (no reload — see storage.js)
        state.widgets = [];
        state.settings = {
            theme: 'system',
            twelvedataApiKey: '',
            corsProxyUrl: '',
            background: { type: 'none', imageUrl: null, imageDataUrl: null, overlayOpacity: 0.45, blurPx: 0 }
        };
        applySettings();           // re-apply theme/background to match the fresh state
        renderDashboard();         // grid goes empty; user sees a clean slate immediately
        closeModal();

        showUndoToast('Reset dashboard', () => {
            // Restore in place (mutate `state` rather than reassigning) so that any
            // closure or handler holding a reference to the original object sees the
            // restored widgets + settings. Re-assigning window.state would leave stale
            // references behind.
            state.widgets = snapshot.widgets;
            state.settings = snapshot.settings;
            Storage.saveData(state);
            applySettings();
            renderDashboard();
        });
    });
    
    document.getElementById('import-data').addEventListener('click', () => {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = '.json';
        input.onchange = e => {
            const file = e.target.files[0];
            const reader = new FileReader();
            reader.onload = ev => {
                Storage.importData(ev.target.result);
                closeModal();
            };
            reader.readAsText(file);
        };
        input.click();
    });

    const bgUpload = document.getElementById('bg-upload');
    if (bgUpload) {
        bgUpload.addEventListener('change', (e) => {
            const file = e.target.files[0];
            if (file) {
                const reader = new FileReader();
                reader.onload = (ev) => {
                    const dataUrl = ev.target.result;
                    // T6: store the image in IndexedDB to avoid eating localStorage quota.
                    // Keep a copy on state for immediate render; persist only the flag + JSON
                    // to localStorage (the data URL itself lives in IDB).
                    const bg = state.settings.background;
                    Storage._idbSetBgImage(dataUrl).then(() => {
                        bg.type = 'upload';
                        bg.imageDataUrl = dataUrl;   // keep for immediate applySettings()
                        bg.hasIdbImage  = true;       // flag: IDB holds the canonical copy
                        // Don't persist imageDataUrl in localStorage — it's in IDB now.
                        const toSave = JSON.parse(JSON.stringify(state));
                        delete toSave.settings.background.imageDataUrl;
                        Storage.saveData(toSave);
                        applySettings();
                    }).catch(err => {
                        console.warn('T6: failed to save bg image to IndexedDB; falling back to localStorage', err);
                        // Fallback: store inline (old behavior) so the user isn't blocked.
                        bg.type = 'upload';
                        bg.imageDataUrl = dataUrl;
                        Storage.saveData(state);
                        applySettings();
                    });
                };
                reader.readAsDataURL(file);
            }
        });
    }
}

function closeModal() {
    const wasOpen = !modalContainer.hidden;
    modalContainer.hidden = true;
    if (wasOpen && lastFocusedBeforeModal) {
        // Return focus to whatever triggered the dialog so keyboard users aren't stranded.
        try { lastFocusedBeforeModal.focus(); } catch(e) {}
        lastFocusedBeforeModal = null;
    }
}

/**
 * Focus management for modals: remember the trigger, then move focus into the
 * dialog (first input or first button). Call right after setting modalContainer.hidden=false.
 */
function _focusIntoModal() {
    if (!lastFocusedBeforeModal) lastFocusedBeforeModal = document.activeElement;
    // Give the browser a tick to finish layout before focusing inside.
    requestAnimationFrame(() => {
        const firstInput  = modalBody.querySelector('input, textarea, select');
        const firstButton = firstInput ? null : modalBody.querySelector('button');
        (firstInput || firstButton || modalContainer).focus();
    });
}

/** Simple trap: keep Tab / Shift+Tab inside the open modal. */
function _trapModalFocus(e) {
    if (e.key !== 'Tab' || modalContainer.hidden) return;
    const focusables = Array.from(modalBody.querySelectorAll(
        'a[href], button:not([disabled]), input, textarea, select, [tabindex]:not([tabindex="-1"])'
    )).filter(el => el.offsetParent !== null);
    if (focusables.length === 0) return;
    const first = focusables[0];
    const last  = focusables[focusables.length - 1];
    if (e.shiftKey && document.activeElement === first) {
        e.preventDefault(); last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault(); first.focus();
    }
}

function addWidget(type) {
    const id = 'widget-' + Date.now();

    // Prefer registry defaults so new types need zero edits here.
    const entry = WidgetRegistry[type];
    let config = {};
    let data = {};
    if (entry && typeof entry.defaults === 'function') {
        try { ({ config, data } = entry.defaults()); } catch(e) { console.warn('defaults() failed', e); }
    }

    const newWidget = {
        id,
        type,
        title: entry ? `New ${entry.label}` : `New ${type.charAt(0).toUpperCase() + type.slice(1)}`,
        position: state.widgets.length,
        span: 1,
        config,
        data
    };

    // Fallback defaults for types not yet in the registry.
    if (!entry || !data.items) {
        if (type === 'shortcuts') newWidget.data = { items: [] };
        if (type === 'lists') newWidget.data = { items: [], showCompleted: true };
        if (type === 'clock' && !newWidget.config.formatType) {
            newWidget.config = { formatType: 12, showSeconds: false, showDate: true };
            newWidget.data = { times: [{ label: 'My Time', timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'America/Denver' }] };
        }
        // C3: type id renamed from 'perplexity' → 'search'.
        if (type === 'search') {
            newWidget.config = { title: 'Search', openInNewTab: true, engine: 'perplexity' };
        }
    }

    state.widgets.push(newWidget);
    state.widgets.sort((a, b) => a.position - b.position);
    Storage.saveData(state);
    renderDashboard();
}

/**
 * Seed data for new users
 */
function seedDashboard() {
    state.widgets = [
        {
            id: 'seed-clock',
            type: 'clock',
            title: 'World Clock',
            position: 0,
            span: 1,
            config: { formatType: 12, showSeconds: false, showDate: true },
            data: {
                times: [
                    { label: 'Home', timezone: 'America/Denver' },
                    { label: 'New York', timezone: 'America/New_York' }
                ]
            }
        },
        {
            id: 'seed-shortcuts',
            type: 'shortcuts',
            title: 'Quick Links',
            position: 1,
            span: 1,
            config: {},
            data: {
                items: [
                    { label: 'Google', url: 'https://google.com', openInNewTab: true },
                    { label: 'GitHub', url: 'https://github.com', openInNewTab: true }
                ]
            }
        }
    ];
    Storage.saveData(state);
    renderDashboard();
}

/**
 * Command Palette (⌘K / Ctrl+K)
 * ----------------------------
 * A lightweight global overlay that lets you jump to a widget or open a shortcut link
 * without hunting through the grid. It is intentionally SEPARATE from #modal-container so it
 * doesn't fight the existing modal Escape/focus-trap handlers: while the palette is open we
 * handle its own keydown and swallow Tab/Escape, then restore focus to whatever opened it.
 *
 * Results are built fresh each time it opens (cheap — reads state.widgets). No new persisted
 * fields. Reuses escapeHtml for safe label rendering.
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
            for (const item of w.data.items) {
                const label = String(item.label || '');
                const desc  = String(item.description || '');
                const url   = String(item.url || '');
                if (!q || label.toLowerCase().includes(q) || desc.toLowerCase().includes(q) || url.toLowerCase().includes(q)) {
                    out.push({ kind: 'link', widgetId: w.id, id: null, label, sublabel: url });
                }
            }
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
        let url = '';
        let match = null;
        if (widget && Array.isArray(widget.data?.items)) {
            // Find the matching item by label to get its current URL.
            match = widget.data.items.find(it => String(it.label || '') === r.label) ||
                    widget.data.items[0];
            url = match ? (match.url || '') : '';
        }
        if (url && /^https?:\/\//i.test(url)) {
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

/**
 * Undo toast system
 * -----------------
 * A small, dependency-free stack of transient notifications that appear in the
 * bottom-right corner. Each toast carries a label and an optional `onUndo` callback.
 * To auto-dismiss after ~6s; clicking "Undo" fires the callback and removes the toast;
 * clicking "Dismiss" (or the ×) just closes it. The stack is capped at 5 — older
 * toasts are dropped so we never accumulate unboundedly.
 *
 * Usage: showUndoToast('Deleted widget', () => { ...restore... });
 */
const undoToasts = {
    maxVisible: 5,
    autoDismissMs: 6000
};

function _getToastRegion() {
    const el = document.getElementById('undo-toast-region');
    if (!el) return null; // markup missing — degrade gracefully (no-op)
    return el;
}

/**
 * Show a toast with an optional Undo button.
 * @param {string} label   Human-readable description of what was done.
 * @param {Function|null} onUndo  Called when the user clicks "Undo". Pass null for info-only toasts.
 */
function showUndoToast(label, onUndo) {
    const region = _getToastRegion();
    if (!region) return; // no region — silent no-op

    // Cap the visible stack: drop the oldest toast(s) beyond maxVisible.
    const existing = region.querySelectorAll('.toast');
    while (existing.length >= undoToasts.maxVisible) {
        existing[0].remove();
    }

    const el = document.createElement('div');
    el.className = 'toast';
    el.setAttribute('role', 'status');
    el.innerHTML = `
        <span class="toast-label">${escapeHtml(label)}</span>
        ${onUndo ? '<button type="button" class="toast-undo-btn">Undo</button>' : ''}
        <button type="button" class="toast-dismiss-btn" aria-label="Dismiss">×</button>
    `;

    let dismissed = false;
    const dismiss = () => {
        if (dismissed) return;
        dismissed = true;
        el.classList.add('leaving');
        setTimeout(() => el.remove(), 200);
    };

    // Auto-dismiss timer.
    const autoTimer = setTimeout(dismiss, undoToasts.autoDismissMs);

    if (onUndo) {
        el.querySelector('.toast-undo-btn').addEventListener('click', () => {
            clearTimeout(autoTimer);
            try { onUndo(); } catch (e) { console.error('Undo failed:', e); }
            dismiss();
        });
    }

    el.querySelector('.toast-dismiss-btn').addEventListener('click', () => {
        clearTimeout(autoTimer);
        dismiss();
    });

    // Pause the auto-dismiss while hovering so users have time to read / click.
    el.addEventListener('mouseenter', () => { if (!dismissed) clearTimeout(autoTimer); });
    el.addEventListener('mouseleave', () => {
        if (dismissed) return;
        setTimeout(dismiss, 2000);
    });

    region.appendChild(el);
}

init();
