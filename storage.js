/**
 * Storage Module
 * Handles all interactions with localStorage + IndexedDB for the dashboard state.
 * Large background images (data URLs) live in IndexedDB under key 'bgImage'
 * to avoid consuming the ~5 MB localStorage quota. A small flag
 * (`settings.background.hasIdbImage`) tells us whether to fetch from IDB on load.
 * This file is the first-loaded classic script, so it creates the shared
 * `window.Dashboard` namespace and publishes its own API as `Dashboard.Storage`.
 * The whole module body lives in an IIFE so nothing leaks to the global scope; a
 * UMD footer at the bottom makes it `require()`-able in Node tests.
 */

(function (root) {
    'use strict';

    // Create the shared namespace once; later files (registry/widgets/app) attach
    // their own API objects to it. `root` is window in the browser, globalThis under
    // Node (see the UMD footer at the bottom of this file).
    root.Dashboard = root.Dashboard || {};

    // App release version shown in Settings. Single source of truth for the UI
    // (keep in sync with package.json). Distinct from CURRENT_VERSION below, which
    // is the localStorage schema / migration number.
    root.Dashboard.APP_VERSION = '1.0.0';

const STORAGE_KEY = 'personalDashboard:data';

// Storage schema version — bumped when migrations change the saved JSON shape.
const CURRENT_VERSION = 5;

const DEFAULT_STATE = {
    version: CURRENT_VERSION,
    settings: {
        theme: 'system',
        // Twelve Data API key (used by the Stock Watchlist widget). Stored locally only.
        twelvedataApiKey: '',
        // Optional CORS proxy endpoint used to fetch cross-origin RSS feeds
        // around browser CORS blocks. Supports a {url} placeholder for the feed URL.
        corsProxyUrl: '',
        // opt-in flag for third-party public proxy fallbacks (allorigins,
        // corsproxy.io, codetabs). Default off — routing a user's feed URL through
        // strangers' public proxies is flaky and a mild privacy smell. The user's own
        // proxy (corsProxyUrl) is always tried first when set.
        rssAllowPublicProxies: false,
        background: {
            type: 'none',
            imageUrl: null,
            imageDataUrl: null,
            overlayOpacity: 0.45,
            blurPx: 0
        },
        // (optional — code falls back when absent, so no migration needed):
        // gridColumns: number of dashboard columns to force (3–6). null/absent = auto-fill.
        // uiScale: global UI zoom as a percentage (e.g. 75–125). 100 = default.
        gridColumns: null,
        uiScale: 100
    },
    widgets: []
};

// ── IndexedDB helpers for the background image blob ───────────────
// The DB is opened lazily and cached so repeated calls don't re-open it.
let _idbInstance = null;

function _openIdb() {
    if (_idbInstance) return Promise.resolve(_idbInstance);
    return new Promise((resolve, reject) => {
        const req = indexedDB.open('dashboard-storage', 1);
        req.onupgradeneeded = (e) => {
            const db = e.target.result;
            if (!db.objectStoreNames.contains('kv')) {
                db.createObjectStore('kv');
            }
        };
        req.onsuccess = (e) => { _idbInstance = e.target.result; resolve(_idbInstance); };
        req.onerror  = () => reject(req.error || new Error('Failed to open IndexedDB'));
    });
}

function _idbGet(key) {
    return _openIdb().then(db => new Promise((resolve, reject) => {
        const tx = db.transaction('kv', 'readonly');
        const r = tx.objectStore('kv').get(key);
        r.onsuccess = () => resolve(r.result !== undefined ? r.result: null);
        r.onerror   = () => reject(r.error || new Error('IDB get failed'));
    }));
}

function _idbSet(key, value) {
    return _openIdb().then(db => new Promise((resolve, reject) => {
        const tx = db.transaction('kv', 'readwrite');
        tx.objectStore('kv').put(value, key);
        tx.oncomplete  = () => resolve();
        tx.onerror     = () => reject(tx.error || new Error('IDB set failed'));
    }));
}

function _idbDelete(key) {
    return _openIdb().then(db => new Promise((resolve, reject) => {
        const tx = db.transaction('kv', 'readwrite');
        tx.objectStore('kv').delete(key);
        tx.oncomplete  = () => resolve();
        tx.onerror     = () => reject(tx.error || new Error('IDB delete failed'));
    }));
}

const BG_IMAGE_KEY = 'bgImage'; // fixed key for the single background image

const Storage = {
    /**
     * Deep-clones the module-level DEFAULT_STATE so callers never mutate the
     * shared singleton. Returning it by reference let user edits (theme,
     * background, etc.) leak into "defaults" used later by reset/migration.
     */
    _defaultState() {
        return structuredClone(DEFAULT_STATE);
    },

    /**
     * returns a fresh clone of the canonical default settings object.
     * This is the single source of truth for "what do default settings look like?"
     * Used by:
     * - the v2→v3 migration backfill (storage.js)
     * - the Reset handler in app/modals/settings.js (replaces its inline copy, which had drifted)
     * - any future code that needs pristine defaults
     * Previously the settings shape was duplicated in three places and had already
     * drifted (the Reset handler's inline copy lacked gridColumns/uiScale).
     */
    defaultSettings() {
        return structuredClone(DEFAULT_STATE.settings);
    },

    /**
     * Retrieves the dashboard data from localStorage.
     * If none exists, returns a fresh copy of the default state (never the live singleton).
     */
    getData() {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (!raw) {
            return this._defaultState();
        }

        try {
            let data = JSON.parse(raw);
            if (typeof data !== 'object' || data === null) throw new Error('Saved state is not an object');
            // a saved object without `version` (hand-edited / partial write) used to
            // make the migration loop a no-op (`undefined < CURRENT_VERSION` is false), so
            // the raw shape flowed straight into renderers. Treat a missing version as 1 so
            // migration runs and fills in the expected shape.
            if (typeof data.version !== 'number') {
                console.warn('Saved dashboard state has no version; assuming v1 and migrating.');
                data.version = 1;
            }
            // Migrate older versions forward to CURRENT_VERSION.
            while (data.version < CURRENT_VERSION) {
                data = this.migrate(data);
            }
            return data;
        } catch (e) {
            // don't silently wipe the user's data. Preserve the corrupt payload under a
            // backup key so it can be recovered/exported, and surface an alert explaining what happened.
            console.error('Failed to parse dashboard data; preserving corrupt payload and resetting.', e);
            try {
                const backupKey = STORAGE_KEY + '.corrupt-' + Date.now();
                localStorage.setItem(backupKey, raw);
            } catch (e2) {
                console.error('Could not write corrupt-data backup either.', e2);
            }
            alert(
                'Your saved dashboard data could not be read and was reset to defaults.\n' +
                'A copy of the original data has been kept in browser storage so it can be recovered.\n' +
                'If you exported a backup recently, you can re-import it from Settings.'
            );
            return this._defaultState();
        }
    },

    /**
     * Saves the dashboard data to localStorage.
     */
    saveData(data) {
        try {
            const dataToSave = {
...data,
                version: CURRENT_VERSION
            };
            localStorage.setItem(STORAGE_KEY, JSON.stringify(dataToSave));
        } catch (e) {
            if (e.name === 'QuotaExceededError') {
                alert('Storage quota exceeded. Please remove some widgets or clear your dashboard.');
            } else {
                console.error('Failed to save dashboard data.', e);
            }
        }
    },

    /**
     * Migrates data from an older version one step forward at a time.
     * Each migration bumps `version` by 1 so the loop in getData can chain them.
     */
    migrate(data) {
        // gate the migration log behind ?debug=1 so normal loads are quiet.
        if (typeof location !== 'undefined' && /[?&]debug=1(&|$)/.test(location.search)) {
            console.log('Migrating dashboard data v' + (data.version || 0) + ' → next…');
        }

        if ((data.version || 0) < 2) {
            // ── v1 → v2: add `span` to every widget so the grid can size cards.
            const widgets = Array.isArray(data.widgets) ? data.widgets: [];
            data = {
...this._defaultState(),
...data,
                version: 2,
                widgets: widgets.map(w => ({
...w,
                    span: [1, 2, 3].includes(w.span) ? w.span: 1
                }))
            };
        }

        if ((data.version || 0) < 3) {
            // ── v2 → v3: add the Twelve Data API key setting (Stock Watchlist).
            // use defaultSettings as the backfill base so the shape stays
            // in sync with DEFAULT_STATE (no more inline copy to drift).
            data = {
...this._defaultState(),
...data,
                version: 3,
                settings: {
...this.defaultSettings(),
...(data.settings || {})
                }
            };
        }

        if ((data.version || 0) < 4) {
            // ── v3 → v4: migrate any background imageDataUrl out of localStorage
            // and into IndexedDB. The data URL is removed from the JSON state after a
            // successful IDB write so it no longer counts against the quota.
            const bg = (data.settings && data.settings.background) || {};
            if (bg.type === 'upload' && typeof bg.imageDataUrl === 'string' && bg.imageDataUrl.length > 0) {
                Storage._idbSetBgImage(bg.imageDataUrl).then(() => {
                    // Flag that IDB holds the image; clear the local copy.
                    if (data.settings && data.settings.background) {
                        data.settings.background.hasIdbImage = true;
                        delete data.settings.background.imageDataUrl;
                    }
                    // Persist immediately so the migration "takes": without this, a
                    // save that lands before/after the IDB write could re-persist the
                    // big data URL to localStorage or leave the flag only in memory.
                    Storage.saveData(data);
                }).catch(err => {
 console.warn(' migration: failed to write bg image to IndexedDB; keeping in localStorage.', err);
                    // Leave imageDataUrl in place as a fallback.
                });
            } else if (bg.type === 'upload') {
                data.settings.background.hasIdbImage = false;
            }
            data.version = 4;
        }

        if ((data.version || 0) < 5) {
            // ── v4 → v5: rename widget type id 'perplexity' → 'search'.
            // The widget is engine-neutral (Perplexity, Google, Bing, DDG); the old
            // name leaked into saved data, palette results, CSS classes and storage
            // fallbacks. A one-line per-widget fix; sanitizeWidget also accepts the
            // legacy id so old exports still import.
            const widgets = Array.isArray(data.widgets) ? data.widgets: [];
            data = {
...this._defaultState(),
...data,
                version: 5,
                widgets: widgets.map(w => (w && w.type === 'perplexity') ? {...w, type: 'search' }: w)
            };
        }

        return data;
    },

    /**
     * Resets the dashboard to default state. Does NOT reload — callers are expected
     * to re-render (renderDashboard) and optionally show an Undo toast so the user
     * can restore their previous data without a full page refresh.
     * also clears any background image stored in IndexedDB.
     */
    reset() {
        localStorage.removeItem(STORAGE_KEY);
        _idbDelete(BG_IMAGE_KEY).catch(() => {}); // best-effort; ignore if IDB unavailable
    },

    /**
     * Exports the dashboard data as a JSON download.
     * Async: when a background upload lives in IndexedDB, embeds imageDataUrl in the
     * payload so export→import round-trips keep the image.
     */
    async exportData() {
        const data = this.getData();
        const bg = (data.settings && data.settings.background) || {};
        if (bg.hasIdbImage && !bg.imageDataUrl) {
            try {
                const dataUrl = await this._idbGetBgImage();
                if (typeof dataUrl === 'string' && dataUrl.length > 0) {
                    data.settings = data.settings || {};
                    data.settings.background = data.settings.background || {};
                    data.settings.background.imageDataUrl = dataUrl;
                    data.settings.background.type = data.settings.background.type || 'upload';
                }
            } catch (err) {
                console.warn('Export: failed to read bg image from IndexedDB', err);
            }
        }
        const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `dashboard_export_${new Date().toISOString().slice(0, 10)}.json`;
        a.click();
        URL.revokeObjectURL(url);
    },

    /**
     * Returns true if the URL string resolves to an http: or https: URL.
     */
    isValidHttpUrl(url) {
        if (typeof url !== 'string') return false;
        try {
            const parsed = new URL(url);
            return parsed.protocol === 'http:' || parsed.protocol === 'https:';
        } catch (e) {
            return false;
        }
    },

    /**
     * Sanitizes a single imported widget using the WidgetRegistry if available,
     * falling back to built-in validation for known types.
     */
    sanitizeWidget(widget) {
        // Prefer registry-based sanitization (covers all current + future types).
        // the registry is on the shared namespace (loaded after this file,
        // but sanitizeWidget is only called at import time, well after all scripts load).
        const getEntry = root.Dashboard && typeof root.Dashboard.getWidgetEntry === 'function'
            ? root.Dashboard.getWidgetEntry: null;
        if (getEntry) {
            const entry = getEntry(widget && widget.type);
            if (entry && typeof entry.sanitize === 'function') {
                const typed = entry.sanitize(widget);
                const applyShell = root.Dashboard && typeof root.Dashboard.applyWidgetShell === 'function'
                    ? root.Dashboard.applyWidgetShell: null;
                return applyShell ? applyShell(widget, typed): typed;
            }
        }

        // the registry is the single source of truth for widget validation. The old
        // fallback here (a duplicate allow-list + generic shape) was dead code in the page —
        // registry.js is always loaded before storage import runs, so a registered type
        // always has an entry.sanitize. We only reach here for an unknown/corrupt type id,
        // which we drop rather than guess at a shape. New widget types need zero edits here.
        if (!widget || typeof widget !== 'object') return null;
        console.warn('[dashboard] sanitizeWidget: no registry entry for type',
            JSON.stringify(widget.type), '— dropping widget.');
        return null;
    },

    /**
     * Imports dashboard data from a JSON string.
     * On success returns `{ ok: true, data, kept, dropped }`; on failure `{ ok: false }`.
     * Callers must apply `data` into the live in-memory state and re-render.
     */
    importData(jsonString) {
        try {
            let data = JSON.parse(jsonString);
            if (!data.version || !Array.isArray(data.widgets)) {
                throw new Error('Invalid data structure');
            }

            // warn when importing from a newer version. The migration loop below
            // only runs forward (v < CURRENT_VERSION), so a newer export passes through
            // unmigrated. Don't silently accept — let the user know some features may not work.
            if (data.version > CURRENT_VERSION) {
                console.warn('Import: data is from a newer version (' + data.version +
                    ' vs current ' + CURRENT_VERSION + '); some features may not work.');
            }

            // Run the same version-migration chain as getData so imports from older
            // builds (v1/v2/…) get per-version fixes — e.g. v1→v2 `span` normalization
            // and settings backfilling — instead of skipping straight to CURRENT_VERSION.
            while ((data.version || 0) < CURRENT_VERSION) {
                data = this.migrate(data);
            }

            const rawCount = data.widgets.length;
            // Sanitize each widget; drop any that fail validation.
            const sanitized = data.widgets
.map(w => this.sanitizeWidget(w))
.filter(w => w !== null);
            const dropped = rawCount - sanitized.length;

            // Re-index positions for a clean layout.
            sanitized.forEach((w, i) => { w.position = i; });

            // spread a fresh clone of the defaults (this._defaultState), not the
            // live DEFAULT_STATE singleton — otherwise an import missing a top-level key
            // would alias the singleton's nested objects and later mutations could leak into "defaults".
            const cleanData = {
...this._defaultState(),
...data,
                version: CURRENT_VERSION,
                widgets: sanitized
            };

            this.saveData(cleanData);

            // if the imported state carries a background image, persist it in IDB.
            const impBg = (cleanData.settings && cleanData.settings.background) || {};
            if (impBg.type === 'upload' && typeof impBg.imageDataUrl === 'string' && impBg.imageDataUrl.length > 0) {
                _idbSet(BG_IMAGE_KEY, impBg.imageDataUrl).then(() => {
                    cleanData.settings.background.hasIdbImage = true;
                    delete cleanData.settings.background.imageDataUrl;
                    this.saveData(cleanData);
                }).catch(err => console.warn('Import: failed to store bg image in IDB', err));
            }

            return { ok: true, data: cleanData, kept: sanitized.length, dropped };
        } catch (e) {
            console.error('Import failed:', e);
            alert('Failed to import dashboard data. The format might be incorrect.');
            return { ok: false };
        }
    },

    // ── public IndexedDB helpers for the background image ───────────────
    _idbGetBgImage()   { return _idbGet(BG_IMAGE_KEY); },
    _idbSetBgImage(d)  { return _idbSet(BG_IMAGE_KEY, d); },
    _idbDeleteBgImage(){ return _idbDelete(BG_IMAGE_KEY); }
};

    // publish the storage API on the shared namespace. This is the only thing
    // other files need from this module; STORAGE_KEY / DEFAULT_STATE stay private.
    root.Dashboard.Storage = Storage;

})(typeof window !== 'undefined' ? window: globalThis);

// UMD footer: let Node tests `require` this file. The IIFE above has already
// run and populated root.Dashboard.Storage; under Node `root` is globalThis, so we
// expose the same object here for a stable require contract.
if (typeof module !== 'undefined' && typeof module.exports !== 'undefined') {
    module.exports = globalThis.Dashboard.Storage;
}
