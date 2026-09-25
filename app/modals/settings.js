/**
 * app/modals/settings.js — the Settings modal: dashboard title, theme, layout (columns +
 * UI scale), header appearance, background image/overlay/blur, CORS proxy, stocks/API keys,
 * and the data actions (save / export / import / reset). Reset uses Storage.defaultSettings()
 * (P2-11) and offers Undo via a toast. Published to Dashboard.openSettingsModal.
 */

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
            <p style="font-size:10px;opacity:.7;margin-top:4px;">Browsers block cross-origin RSS feeds (CORS). If you have a working proxy endpoint, paste it here — use the placeholder <code>{url}</code> where the feed URL should go. The README recommends running your own Cloudflare Worker (see RSS section).</p>
        </div>
        <div class="settings-group">
            <label style="display:flex;align-items:center;gap:6px;cursor:pointer;">
                <input type="checkbox" id="rss-allow-public-proxies" ${state.settings.rssAllowPublicProxies ? 'checked' : ''}>
                Allow third-party public proxies for RSS
            </label>
            <p style="font-size:10px;opacity:.7;margin-top:4px;">When enabled, feeds that fail via direct fetch and your own proxy will also be tried through well-known public proxies (allorigins, corsproxy.io, codetabs). These are unreliable and route your feed URL through third-party servers. Default: off.</p>
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
    // P2-1: set the accessible name so screen readers announce "Settings".
    _setModalTitle('Settings');
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
        // P1-7: opt-in flag for third-party public RSS proxy fallbacks.
        const rssProxyEl = document.getElementById('rss-allow-public-proxies');
        state.settings.rssAllowPublicProxies = rssProxyEl ? rssProxyEl.checked : false;
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

        Dashboard.Storage.saveData(state);
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

    document.getElementById('export-data').addEventListener('click', () => Dashboard.Storage.exportData());
    document.getElementById('reset-data').addEventListener('click', () => {
        if (!confirm('Are you sure you want to reset the dashboard? You can undo this from the toast that appears after.')) return;

        // Snapshot BEFORE we wipe, so Undo can restore everything.
        const snapshot = JSON.parse(JSON.stringify(state));

        Dashboard.Storage.reset();            // removes localStorage key (no reload — see storage.js)
        state.widgets = [];
        // P2-11: use the canonical default settings (includes gridColumns/uiScale,
        // which the old inline copy was missing).
        state.settings = Dashboard.Storage.defaultSettings();
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
            Dashboard.Storage.saveData(state);
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
                Dashboard.Storage.importData(ev.target.result);
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
                    Dashboard.Storage._idbSetBgImage(dataUrl).then(() => {
                        bg.type = 'upload';
                        bg.imageDataUrl = dataUrl;   // keep for immediate applySettings()
                        bg.hasIdbImage  = true;       // flag: IDB holds the canonical copy
                        // Don't persist imageDataUrl in localStorage — it's in IDB now.
                        const toSave = JSON.parse(JSON.stringify(state));
                        delete toSave.settings.background.imageDataUrl;
                        Dashboard.Storage.saveData(toSave);
                        applySettings();
                    }).catch(err => {
                        console.warn('T6: failed to save bg image to IndexedDB; falling back to localStorage', err);
                        // Fallback: store inline (old behavior) so the user isn't blocked.
                        bg.type = 'upload';
                        bg.imageDataUrl = dataUrl;
                        Dashboard.Storage.saveData(state);
                        applySettings();
                    });
                };
                reader.readAsDataURL(file);
            }
        });
    }
}

// Publish the public API on the shared namespace.
Dashboard.openSettingsModal = openSettingsModal;
