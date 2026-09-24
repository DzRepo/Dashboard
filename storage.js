/**
 * Storage Module
 * Handles all interactions with localStorage + IndexedDB for the dashboard state.
 *
 * T6: Large background images (data URLs) live in IndexedDB under key 'bgImage'
 * to avoid consuming the ~5 MB localStorage quota. A small flag
 * (`settings.background.hasIdbImage`) tells us whether to fetch from IDB on load.
 */

const STORAGE_KEY = 'personalDashboard:data';

// C3: bumped to 5 for the 'perplexity' → 'search' type-id rename migration.
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
        background: {
            type: 'none',
            imageUrl: null,
            imageDataUrl: null,
            overlayOpacity: 0.45,
            blurPx: 0
        },
        // T18 (optional — code falls back when absent, so no migration needed):
        //   gridColumns: number of dashboard columns to force (3–6). null/absent = auto-fill.
        //   uiScale:     global UI zoom as a percentage (e.g. 75–125). 100 = default.
        gridColumns: null,
        uiScale: 100
    },
    widgets: []
};

// ── T6: IndexedDB helpers for the background image blob ───────────────
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
        r.onsuccess = () => resolve(r.result !== undefined ? r.result : null);
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
            // Migrate older versions forward to CURRENT_VERSION.
            while (data.version < CURRENT_VERSION) {
                data = this.migrate(data);
            }
            return data;
        } catch (e) {
            console.error('Failed to parse dashboard data, resetting to default.', e);
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
     * Each migration bumps `version` by 1 so the loop in getData() can chain them.
     */
    migrate(data) {
        console.log('Migrating dashboard data v' + (data.version || 0) + ' → next…');

        if ((data.version || 0) < 2) {
            // ── v1 → v2: add `span` to every widget so the grid can size cards.
            const widgets = Array.isArray(data.widgets) ? data.widgets : [];
            data = {
                ...this._defaultState(),
                ...data,
                version: 2,
                widgets: widgets.map(w => ({
                    ...w,
                    span: [1, 2, 3].includes(w.span) ? w.span : 1
                }))
            };
        }

        if ((data.version || 0) < 3) {
            // ── v2 → v3: add the Twelve Data API key setting (Stock Watchlist).
            data = {
                ...this._defaultState(),
                ...data,
                version: 3,
                settings: {
                    theme: 'system',
                    twelvedataApiKey: '',
                    background: { type: 'none', imageUrl: null, imageDataUrl: null, overlayOpacity: 0.45, blurPx: 0 },
                    ...(data.settings || {})
                }
            };
        }

        if ((data.version || 0) < 4) {
            // ── v3 → v4 (T6): migrate any background imageDataUrl out of localStorage
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
                    console.warn('T6 migration: failed to write bg image to IndexedDB; keeping in localStorage.', err);
                    // Leave imageDataUrl in place as a fallback.
                });
            } else if (bg.type === 'upload') {
                data.settings.background.hasIdbImage = false;
            }
            data.version = 4;
        }

        if ((data.version || 0) < 5) {
            // ── v4 → v5 (C3): rename widget type id 'perplexity' → 'search'.
            // The widget is engine-neutral (Perplexity, Google, Bing, DDG); the old
            // name leaked into saved data, palette results, CSS classes and storage
            // fallbacks. A one-line per-widget fix; sanitizeWidget() also accepts the
            // legacy id so old exports still import.
            const widgets = Array.isArray(data.widgets) ? data.widgets : [];
            data = {
                ...this._defaultState(),
                ...data,
                version: 5,
                widgets: widgets.map(w => (w && w.type === 'perplexity') ? { ...w, type: 'search' } : w)
            };
        }

        return data;
    },

    /**
     * Resets the dashboard to default state. Does NOT reload — callers are expected
     * to re-render (renderDashboard) and optionally show an Undo toast so the user
     * can restore their previous data without a full page refresh.
     *
     * T6: also clears any background image stored in IndexedDB.
     */
    reset() {
        localStorage.removeItem(STORAGE_KEY);
        _idbDelete(BG_IMAGE_KEY).catch(() => {}); // best-effort; ignore if IDB unavailable
    },

    /**
     * Exports the dashboard data as a JSON string.
     */
    exportData() {
        const data = this.getData();
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
        if (typeof getWidgetEntry === 'function') {
            const entry = getWidgetEntry(widget && widget.type);
            if (entry && typeof entry.sanitize === 'function') {
                return entry.sanitize(widget);
            }
        }

        // Fallback for environments where registry.js isn't loaded (or a type's
        // entry lacks sanitize). Derive the allow-list from the live registry when
        // available so it can't drift; otherwise fall back to the core types.
        if (!widget || typeof widget !== 'object') return null;
        const VALID_TYPES = (typeof getRegisteredTypes === 'function' && Array.isArray(getRegisteredTypes()) && getRegisteredTypes().length)
            ? getRegisteredTypes()
            : ['shortcuts', 'lists', 'clock', 'search']; // C3: renamed from 'perplexity'
        if (!VALID_TYPES.includes(widget.type)) return null;

        return {
            id: (typeof widget.id === 'string' && widget.id) ? widget.id : 'widget-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8),
            type: widget.type,
            title: (typeof widget.title === 'string') ? widget.title : widget.type,
            position: (typeof widget.position === 'number') ? widget.position : 0,
            span: [1, 2, 3].includes(widget.span) ? widget.span : 1,
            config: (widget.config && typeof widget.config === 'object') ? widget.config : {},
            data: (widget.data && typeof widget.data === 'object') ? widget.data : {}
        };
    },

    /**
     * Imports dashboard data from a JSON string.
     */
    importData(jsonString) {
        try {
            let data = JSON.parse(jsonString);
            if (!data.version || !Array.isArray(data.widgets)) {
                throw new Error('Invalid data structure');
            }

            // Run the same version-migration chain as getData() so imports from older
            // builds (v1/v2/…) get per-version fixes — e.g. v1→v2 `span` normalization
            // and settings backfilling — instead of skipping straight to CURRENT_VERSION.
            while ((data.version || 0) < CURRENT_VERSION) {
                data = this.migrate(data);
            }

            // Sanitize each widget; drop any that fail validation.
            const sanitized = data.widgets
                .map(w => this.sanitizeWidget(w))
                .filter(w => w !== null);

            // Re-index positions for a clean layout.
            sanitized.forEach((w, i) => { w.position = i; });

            const cleanData = {
                ...DEFAULT_STATE,
                ...data,
                version: CURRENT_VERSION,
                widgets: sanitized
            };

            this.saveData(cleanData);

            // T6: if the imported state carries a background image, persist it in IDB.
            const impBg = (cleanData.settings && cleanData.settings.background) || {};
            if (impBg.type === 'upload' && typeof impBg.imageDataUrl === 'string' && impBg.imageDataUrl.length > 0) {
                _idbSet(BG_IMAGE_KEY, impBg.imageDataUrl).then(() => {
                    cleanData.settings.background.hasIdbImage = true;
                    delete cleanData.settings.background.imageDataUrl;
                    this.saveData(cleanData);
                }).catch(err => console.warn('Import: failed to store bg image in IDB', err));
            }

            return true;
        } catch (e) {
            console.error('Import failed:', e);
            alert('Failed to import dashboard data. The format might be incorrect.');
            return false;
        }
    },

    // ── T6: public IndexedDB helpers for the background image ───────────────
    _idbGetBgImage()   { return _idbGet(BG_IMAGE_KEY); },
    _idbSetBgImage(d)  { return _idbSet(BG_IMAGE_KEY, d); },
    _idbDeleteBgImage(){ return _idbDelete(BG_IMAGE_KEY); }
};
