/**
 * app/boot.js — application boot + the core UI logic: settings/theme application, color
 * utilities, dashboard rendering (createWidgetElement), grid-level delegated event handlers
 * (click / input / change / keypress + global shortcuts), widget actions, modal plumbing
 * (open/close/focus-trap), addWidget/seedDashboard, and init(). Loaded last among the app/
 * files; it wires up all listeners, calls Dashboard.init() in a browser, and publishes the
 * shared globals (state/saveFullState/announceStatus/color utils) on Dashboard.
 */

/**
 * T6 — Load the background image from IndexedDB (if flagged) and set it on state.
 * Resolves immediately if there's nothing to load, so init() can await it safely.
 */
async function _loadBgImageFromIdb() {
    const bg = state.settings && state.settings.background;
    if (!bg || bg.type !== 'upload' || !bg.hasIdbImage) return; // nothing in IDB
    try {
        const dataUrl = await Dashboard.Storage._idbGetBgImage();
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
    if (typeof Dashboard.pruneHabitsLog === 'function') {
        let pruned = false;
        for (const w of state.widgets) {
            if (w && w.type === 'habits' && Dashboard.pruneHabitsLog(w)) pruned = true;
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
    Dashboard._paletteInit();

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

    // Seed only on true first run (P1-5): an empty `widgets` array can mean the user
    // deleted every widget, which must stay empty across reloads. `settings.seeded`
    // is set by seedDashboard() on first run, so it distinguishes the two cases.
    if (state.widgets.length === 0 && !(state.settings && state.settings.seeded)) {
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
    // orphaned 1s intervals (see widgetTimers in widgets/shared/helpers.js).
    if (typeof Dashboard.clearAllWidgetTimers === 'function') {
        Dashboard.clearAllWidgetTimers();
    }

    dashboardGrid.innerHTML = '';
    state.widgets.forEach(widget => {
        const widgetElement = createWidgetElement(widget);
        dashboardGrid.appendChild(widgetElement);
    });
}

// createWidgetElement (builds a single widget card's DOM + fill color + drag/keyboard
// reorder wiring) lives in app/widget-card.js — extracted from this file (P2-10).

// Grid-level delegated event handlers (click / input / change / keypress, global
// shortcuts, and the Perplexity search runner) live in app/grid.js — extracted from this
// file (P2-10) to keep boot.js under the ~500-line target. They are attached in init()
// above via the shared globals.

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

function saveFullState() {
    Dashboard.Storage.saveData(state);
}

// Modal plumbing (closeModal / _focusIntoModal / _trapModalFocus) lives in
// app/modals/modal.js — extracted from this file (P2-10) to keep boot.js under the
// ~500-line target. They are shared by all modal open functions and boot's init().

function addWidget(type) {
    const id = 'widget-' + Date.now();

    // Prefer registry defaults so new types need zero edits here.
    const entry = Dashboard.WidgetRegistry[type];
    let config = {};
    let data = {};
    if (entry && typeof entry.defaults === 'function') {
        try { ({ config, data } = entry.defaults()); } catch(e) { console.warn('defaults() failed', e); }
    }

    // P2-8: defaults come exclusively from the registry (entry.defaults()). The old
    // per-type fallback block here was dead code — every registered type has a defaults()
    // method, so an unknown `type` is the only case that reaches here and it's handled by
    // sanitizeWidget() on save. New widget types need zero edits in this function.
    const newWidget = {
        id,
        type,
        title: entry ? `New ${entry.label}` : `New ${type.charAt(0).toUpperCase() + type.slice(1)}`,
        position: state.widgets.length,
        span: 1,
        config,
        data
    };

    state.widgets.push(newWidget);
    state.widgets.sort((a, b) => a.position - b.position);
    Dashboard.Storage.saveData(state);
    renderDashboard();
}

/**
 * Seed data for new users
 */
function seedDashboard() {
    // Mark first-run seeding so a later intentionally-emptied dashboard is not
    // re-seeded on reload (P1-5).
    state.settings = state.settings || {};
    state.settings.seeded = true;

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
    Dashboard.Storage.saveData(state);
    renderDashboard();
}

// ── Publish the app module's public API on the shared namespace ─────────────
Dashboard.state = state;
Dashboard.saveFullState = saveFullState;
Dashboard.announceStatus = announceStatus;

// Color utilities (used across the app files; published for tests).
Dashboard.hexToRgb = hexToRgb;
Dashboard.rgbaString = rgbaString;
Dashboard.adjustFillForTheme = adjustFillForTheme;

// Boot.
Dashboard.init = init;

// UMD footer (P2-9): expose the app module for Node tests.
if (typeof module !== 'undefined' && typeof module.exports !== 'undefined') {
    // Under Node, the files above have already run and populated globalThis.Dashboard.
    module.exports = globalThis.Dashboard;
}

// Boot the application (browser only — guarded so Node tests don't run DOM code).
if (typeof window !== 'undefined') {
    Dashboard.init();
}
