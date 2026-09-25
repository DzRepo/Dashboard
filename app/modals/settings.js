/**
 * app/modals/settings.js — Settings modal with tabbed sections: General, Layout,
 * Appearance, APIs & Feeds, and Data. Footer shows Save plus the app version.
 * Reset uses Storage.defaultSettings() and offers Undo via a toast.
 * Published to Dashboard.openSettingsModal.
 */

function openSettingsModal() {
    const dashTitle = (state.settings.dashboardTitle && state.settings.dashboardTitle.trim())
        ? state.settings.dashboardTitle
        : 'My Dashboard';
    // Human-facing release (Dashboard.APP_VERSION in storage.js) — not the storage schema CURRENT_VERSION.
    const appVersion = Dashboard.APP_VERSION || '0.0.0';
    const uiScale = state.settings.uiScale != null ? state.settings.uiScale : 100;
    const headerOpPct = Math.round((state.settings.headerOpacity != null ? state.settings.headerOpacity : 0.9) * 100);

    modalBody.innerHTML = `
        <div class="settings-modal">
            <div class="settings-header">
                <h3 class="settings-title">Settings</h3>
            </div>

            <div class="settings-tabs" role="tablist" aria-label="Settings sections">
                <button type="button" class="settings-tab" role="tab" id="settings-tab-general"
                        aria-controls="settings-panel-general" aria-selected="true" data-tab="general">General</button>
                <button type="button" class="settings-tab" role="tab" id="settings-tab-layout"
                        aria-controls="settings-panel-layout" aria-selected="false" data-tab="layout" tabindex="-1">Layout</button>
                <button type="button" class="settings-tab" role="tab" id="settings-tab-appearance"
                        aria-controls="settings-panel-appearance" aria-selected="false" data-tab="appearance" tabindex="-1">Appearance</button>
                <button type="button" class="settings-tab" role="tab" id="settings-tab-apis"
                        aria-controls="settings-panel-apis" aria-selected="false" data-tab="apis" tabindex="-1">APIs &amp; Feeds</button>
                <button type="button" class="settings-tab" role="tab" id="settings-tab-data"
                        aria-controls="settings-panel-data" aria-selected="false" data-tab="data" tabindex="-1">Data</button>
            </div>

            <div class="settings-panels">
                <div class="settings-panel" role="tabpanel" id="settings-panel-general"
                     aria-labelledby="settings-tab-general" data-panel="general">
                    <div class="settings-group">
                        <label for="dashboard-title-input">Dashboard title</label>
                        <input type="text" id="dashboard-title-input" value="${escapeHtml(dashTitle)}" placeholder="My Dashboard">
                        <p class="settings-hint">Shown in the header. Leave blank to use “My Dashboard”.</p>
                    </div>
                    <div class="settings-group">
                        <label for="theme-select">Theme</label>
                        <select id="theme-select">
                            <option value="system" ${state.settings.theme === 'system' ? 'selected': ''}>System</option>
                            <option value="light"  ${state.settings.theme === 'light'  ? 'selected': ''}>Light</option>
                            <option value="dark"   ${state.settings.theme === 'dark'   ? 'selected': ''}>Dark</option>
                        </select>
                    </div>
                </div>

                <div class="settings-panel" role="tabpanel" id="settings-panel-layout"
                     aria-labelledby="settings-tab-layout" data-panel="layout" hidden>
                    <div class="settings-group">
                        <label for="layout-columns">Columns</label>
                        <select id="layout-columns">
                            <option value="auto" ${(!state.settings.gridColumns) ? 'selected': ''}>Auto (fit to width)</option>
                            <option value="3"  ${state.settings.gridColumns === 3 ? 'selected': ''}>3 columns</option>
                            <option value="4"  ${state.settings.gridColumns === 4 ? 'selected': ''}>4 columns</option>
                            <option value="5"  ${state.settings.gridColumns === 5 ? 'selected': ''}>5 columns</option>
                            <option value="6"  ${state.settings.gridColumns === 6 ? 'selected': ''}>6 columns</option>
                        </select>
                        <p class="settings-hint">How many widget columns to show. “Auto” fits as many as the width allows.</p>
                    </div>
                    <div class="settings-group">
                        <label for="ui-scale">UI size / zoom</label>
                        <input type="range" id="ui-scale" min="75" max="125" step="5"
                               value="${uiScale}" aria-label="Dashboard UI scale">
                        <p class="settings-hint" id="ui-scale-hint">Scales the whole dashboard (like browser zoom, but saved). ${Math.round(uiScale)}%</p>
                    </div>
                </div>

                <div class="settings-panel" role="tabpanel" id="settings-panel-appearance"
                     aria-labelledby="settings-tab-appearance" data-panel="appearance" hidden>
                    <h4 class="settings-subheader">Header</h4>
                    <div class="settings-group">
                        <label for="header-bg-color">Header background color</label>
                        <div class="settings-inline-row">
                            <input type="color" id="header-bg-color"
                                   value="${state.settings.headerBgColor || '#2a2a3e'}"
                                   aria-label="Header background color">
                            <span id="header-bg-color-hint" class="settings-hint-inline">
                                ${state.settings.headerBgColor ? state.settings.headerBgColor: 'Theme default'}
                            </span>
                        </div>
                        <button type="button" id="header-bg-clear" class="settings-secondary-btn">Use theme default</button>
                    </div>
                    <div class="settings-group">
                        <label for="header-opacity">Header opacity</label>
                        <input type="range" id="header-opacity" min="10" max="100" step="5"
                               value="${headerOpPct}" aria-label="Header opacity">
                    </div>

                    <h4 class="settings-subheader">Background</h4>
                    <div class="settings-group">
                        <label for="bg-url">Background image URL</label>
                        <input type="text" id="bg-url" value="${escapeAttr(state.settings.background.imageUrl || '')}">
                    </div>
                    <div class="settings-group">
                        <label for="bg-upload">Upload background</label>
                        <input type="file" id="bg-upload" accept="image/*">
                        <p class="settings-hint">Uploads are stored in IndexedDB (not localStorage).</p>
                    </div>
                    <div class="settings-group">
                        <label for="bg-opacity">Overlay opacity</label>
                        <input type="range" id="bg-opacity" min="0" max="1" step="0.1" value="${state.settings.background.overlayOpacity}">
                    </div>
                    <div class="settings-group">
                        <label for="bg-blur">Blur</label>
                        <input type="range" id="bg-blur" min="0" max="20" step="1" value="${state.settings.background.blurPx}">
                    </div>
                </div>

                <div class="settings-panel" role="tabpanel" id="settings-panel-apis"
                     aria-labelledby="settings-tab-apis" data-panel="apis" hidden>
                    <h4 class="settings-subheader">RSS</h4>
                    <div class="settings-group">
                        <label for="cors-proxy-url">CORS proxy URL (optional)</label>
                        <input type="text" id="cors-proxy-url"
                               placeholder="e.g. https://myproxy.example.com/proxy?url={url}"
                               value="${escapeHtml(state.settings.corsProxyUrl || '')}">
                        <p class="settings-hint">Browsers block cross-origin RSS feeds (CORS). Paste a proxy endpoint and use <code>{url}</code> where the feed URL should go. See the README for a Cloudflare Worker example.</p>
                    </div>
                    <div class="settings-group">
                        <label class="checkbox-label">
                            <input type="checkbox" id="rss-allow-public-proxies" ${state.settings.rssAllowPublicProxies ? 'checked': ''}>
                            Allow third-party public proxies for RSS
                        </label>
                        <p class="settings-hint">When enabled, failed feeds also try public proxies (allorigins, corsproxy.io, codetabs). Unreliable and routes feed URLs through third parties. Default: off.</p>
                    </div>

                    <h4 class="settings-subheader">Stocks</h4>
                    <div class="settings-group">
                        <label for="twelvedata-key">Twelve Data API key</label>
                        <input type="password" id="twelvedata-key" placeholder="Your Twelve Data key"
                               value="${escapeHtml(state.settings.twelvedataApiKey || '')}" autocomplete="off">
                        <p class="settings-hint">Stored locally only. Free keys at twelvedata.com.</p>
                    </div>
                    <div class="settings-group">
                        <label for="stock-link-template">Stock link URL template</label>
                        <input type="text" id="stock-link-template"
                               placeholder="https://www.google.com/finance/beta/quote/{ticker}"
                               value="${escapeHtml(state.settings.stockLinkTemplate || '')}">
                        <p class="settings-hint">Use <code>{ticker}</code> for the symbol. Leave blank for Google Finance.</p>
                    </div>
                </div>

                <div class="settings-panel" role="tabpanel" id="settings-panel-data"
                     aria-labelledby="settings-tab-data" data-panel="data" hidden>
                    <p class="settings-hint settings-hint-lead">Export a backup before importing or resetting. There is no server-side copy of your data.</p>
                    <div class="settings-data-actions">
                        <button type="button" id="export-data">Export JSON</button>
                        <button type="button" id="import-data">Import JSON</button>
                        <button type="button" id="reset-data" class="danger">Reset Dashboard</button>
                    </div>
                </div>
            </div>

            <div class="settings-footer">
                <span class="settings-footer-version" aria-hidden="true">Personal Dashboard v${escapeHtml(appVersion)}</span>
                <button type="button" id="save-settings" class="primary">Save Settings</button>
            </div>
        </div>
    `;

    _setModalTitle('Settings');
    modalContainer.hidden = false;
    const modalContent = modalContainer.querySelector('.modal-content');
    if (modalContent) modalContent.classList.add('modal-content--settings');
    _focusIntoModal();

    // ── Tab switching ─────────────────────────────────────────────────────
    const tabs = Array.from(modalBody.querySelectorAll('.settings-tab'));
    const panels = Array.from(modalBody.querySelectorAll('.settings-panel'));

    function activateTab(name) {
        tabs.forEach(tab => {
            const on = tab.dataset.tab === name;
            tab.setAttribute('aria-selected', on ? 'true': 'false');
            tab.tabIndex = on ? 0: -1;
            tab.classList.toggle('is-active', on);
        });
        panels.forEach(panel => {
            panel.hidden = panel.dataset.panel !== name;
        });
    }

    activateTab('general');

    tabs.forEach(tab => {
        tab.addEventListener('click', () => activateTab(tab.dataset.tab));
        tab.addEventListener('keydown', (e) => {
            const order = tabs.map(t => t.dataset.tab);
            const i = order.indexOf(tab.dataset.tab);
            let next = -1;
            if (e.key === 'ArrowRight' || e.key === 'ArrowDown') next = (i + 1) % tabs.length;
            else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') next = (i - 1 + tabs.length) % tabs.length;
            else if (e.key === 'Home') next = 0;
            else if (e.key === 'End') next = tabs.length - 1;
            if (next < 0) return;
            e.preventDefault();
            activateTab(order[next]);
            tabs[next].focus();
        });
    });

    // ── Header color live preview ─────────────────────────────────────────
    const headerColorInput = document.getElementById('header-bg-color');
    const headerOpacityInput = document.getElementById('header-opacity');
    const headerHint = document.getElementById('header-bg-color-hint');

    function _applyHeaderPreview() {
        if (!headerColorInput) return;
        const rgb = hexToRgb(headerColorInput.value || '');
        if (rgb) {
            const op = headerOpacityInput ? parseInt(headerOpacityInput.value, 10) / 100: 0.9;
            const headerEl = document.querySelector('header');
            if (headerEl) headerEl.style.background = rgbaString(rgb.r, rgb.g, rgb.b, op);
            if (headerHint) headerHint.textContent = headerColorInput.value;
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
            const headerEl = document.querySelector('header');
            if (headerEl) headerEl.style.background = '';
            if (headerHint) headerHint.textContent = 'Theme default';
        });
    }

    // ── Save ──────────────────────────────────────────────────────────────
    document.getElementById('save-settings').addEventListener('click', () => {
        const titleInput = document.getElementById('dashboard-title-input');
        if (titleInput) state.settings.dashboardTitle = titleInput.value.trim();
        state.settings.theme = document.getElementById('theme-select').value;

        const colsEl = document.getElementById('layout-columns');
        if (colsEl) {
            const v = colsEl.value;
            state.settings.gridColumns = (v === 'auto') ? null: parseInt(v, 10);
        }
        const uiScaleEl = document.getElementById('ui-scale');
        if (uiScaleEl) {
            let s = parseInt(uiScaleEl.value, 10);
            if (!Number.isFinite(s)) s = 100;
            state.settings.uiScale = Math.min(200, Math.max(50, s));
        }

        state.settings.twelvedataApiKey = (document.getElementById('twelvedata-key')?.value || '').trim();
        state.settings.corsProxyUrl = (document.getElementById('cors-proxy-url')?.value || '').trim();
        const rssProxyEl = document.getElementById('rss-allow-public-proxies');
        state.settings.rssAllowPublicProxies = rssProxyEl ? rssProxyEl.checked: false;

        const stockLinkEl = document.getElementById('stock-link-template');
        if (stockLinkEl) {
            const tmpl = stockLinkEl.value.trim();
            if (!tmpl) {
                state.settings.stockLinkTemplate = null;
            } else if (tmpl.includes('{ticker}') && Dashboard.Storage.isValidHttpUrl(tmpl.replace('{ticker}', 'AAPL'))) {
                state.settings.stockLinkTemplate = tmpl;
            } else {
                state.settings.stockLinkTemplate = null;
                alert('Stock link template must be an http(s) URL containing {ticker}. Cleared to default.');
            }
        }

        const bgUrlVal = (document.getElementById('bg-url').value || '').trim();
        state.settings.background.imageUrl = bgUrlVal || null;
        if (bgUrlVal) {
            state.settings.background.type = 'url';
        } else if (state.settings.background.type === 'url') {
            state.settings.background.type = 'none';
        }
        state.settings.background.overlayOpacity = parseFloat(document.getElementById('bg-opacity').value);
        state.settings.background.blurPx = parseInt(document.getElementById('bg-blur').value, 10);

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

    // Live previews
    const bgBlurInput = document.getElementById('bg-blur');
    if (bgBlurInput) {
        bgBlurInput.addEventListener('input', (e) => {
            document.documentElement.style.setProperty('--blur-amount', `${e.target.value}px`);
        });
    }

    const uiScalePreview = document.getElementById('ui-scale');
    if (uiScalePreview) {
        uiScalePreview.addEventListener('input', (e) => {
            const pct = parseInt(e.target.value, 10);
            _applyUiScale(pct);
            const hint = document.getElementById('ui-scale-hint');
            if (hint) hint.textContent = `Scales the whole dashboard (like browser zoom, but saved). ${pct}%`;
        });
    }
    const colsPreview = document.getElementById('layout-columns');
    if (colsPreview) {
        colsPreview.addEventListener('change', () => { _applyGridColumns(colsPreview.value); });
    }

    // ── Data actions ──────────────────────────────────────────────────────
    document.getElementById('export-data').addEventListener('click', () => Dashboard.Storage.exportData());

    document.getElementById('reset-data').addEventListener('click', () => {
        if (!confirm('Are you sure you want to reset the dashboard? You can undo this from the toast that appears after.')) return;

        const snapshot = JSON.parse(JSON.stringify(state));

        Dashboard.Storage.reset();
        state.widgets = [];
        state.settings = Dashboard.Storage.defaultSettings();
        applySettings();
        renderDashboard();
        closeModal();

        showUndoToast('Reset dashboard', () => {
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
                const result = Dashboard.Storage.importData(ev.target.result);
                if (!result || !result.ok || !result.data) {
                    closeModal();
                    return;
                }
                const imported = result.data;
                state.widgets = imported.widgets;
                state.settings = imported.settings;
                state.version = imported.version;
                const bg = state.settings && state.settings.background;
                const finish = () => {
                    applySettings();
                    renderDashboard();
                    closeModal();
                    const droppedNote = result.dropped
                        ? ` (${result.dropped} widget${result.dropped === 1 ? '': 's'} dropped)`
: '';
                    showUndoToast(`Imported ${result.kept} widget${result.kept === 1 ? '': 's'}${droppedNote}`, null);
                };
                if (bg && bg.hasIdbImage && !bg.imageDataUrl) {
                    Dashboard.Storage._idbGetBgImage().then((dataUrl) => {
                        if (typeof dataUrl === 'string' && dataUrl.length > 0) {
                            bg.imageDataUrl = dataUrl;
                        }
                        finish();
                    }).catch(() => finish());
                } else {
                    finish();
                }
            };
            reader.readAsText(file);
        };
        input.click();
    });

    const bgUpload = document.getElementById('bg-upload');
    if (bgUpload) {
        bgUpload.addEventListener('change', (e) => {
            const file = e.target.files[0];
            if (!file) return;
            const reader = new FileReader();
            reader.onload = (ev) => {
                const dataUrl = ev.target.result;
                const bg = state.settings.background;
                Dashboard.Storage._idbSetBgImage(dataUrl).then(() => {
                    bg.type = 'upload';
                    bg.imageDataUrl = dataUrl;
                    bg.hasIdbImage = true;
                    const toSave = JSON.parse(JSON.stringify(state));
                    delete toSave.settings.background.imageDataUrl;
                    Dashboard.Storage.saveData(toSave);
                    applySettings();
                }).catch(err => {
                    console.warn('Failed to save background image to IndexedDB; falling back to localStorage', err);
                    bg.type = 'upload';
                    bg.imageDataUrl = dataUrl;
                    Dashboard.Storage.saveData(state);
                    applySettings();
                });
            };
            reader.readAsDataURL(file);
        });
    }
}

Dashboard.openSettingsModal = openSettingsModal;
