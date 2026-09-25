/**
 * Service Worker — Personal Dashboard PWA shell.
 * ---------------------------------------------
 * Strategy: cache-first for the app shell (index.html, CSS/JS), network-
 * fallback-to-cache for runtime requests to same-origin assets. External
 * fetches (weather API, favicon endpoint) are NOT intercepted so they keep
 * their normal CORS / caching behaviour and we don't accidentally serve a
 * stale response from cache when the user is online.
 *
 * Versioning: bump CACHE_VERSION on any app-shell change; old caches are
 * garbage-collected in `activate`.
 */

// Bumped v1→v2 on 2026-09-13: T1–T7 changed all JS files; the SW was still
// serving stale cached copies to PWA/HTTP users, causing "Unknown widget type"
// regressions. The activate handler below deletes non-matching caches automatically.
// Bumped v2→v3 on 2026-09-24: P2-10 split widgets.js into per-type files under
// widgets/ and will split app.js into app/ — the asset list below changed, so a
// cache bump is required (see README Deploy checklist).
const CACHE_NAME = 'personal-dashboard-v4';
// RELEASE CHECKLIST: bump CACHE_NAME whenever index.html / app shell JS/CSS change.
// APP_SHELL must stay in sync with <script src> tags in index.html (see test/app-shell-sync.test.js).
// I4: kept a single canonical key ('./index.html') — the bare './' entry was
// redundant and caused duplicate cache entries. The navigate handler below also
// uses './index.html' as its put() target, so all paths agree on one key.
const APP_SHELL = [
    './index.html',          // start_url (canonical)
    './style.css',
    './storage.js',
    // P2-10: widgets split into per-type files (shared helpers first, then renderers).
    './widgets/shared/helpers.js',
    './widgets/shortcuts.js',
    './widgets/lists.js',
    './widgets/clock.js',
    './widgets/search.js',
    './widgets/weather.js',
    './widgets/notes.js',
    './widgets/stocks.js',
    './widgets/countdown.js',
    './widgets/rss.js',
    './widgets/pomodoro.js',
    './widgets/currency.js',
    './widgets/habits.js',
    './registry.js',
    // P2-10: app split into app/ (loaded in dependency order; boot last).
    './app/state.js',
    './app/toasts.js',
    './app/dnd.js',
    './app/widget-card.js',
    './app/grid.js',
    './app/palette.js',
    './app/modals/modal.js',
    './app/modals/edit-widget.js',
    './app/modals/settings.js',
    './app/boot.js',
    './manifest.webmanifest',
    // Icons referenced by the manifest + <link> tags.
    './icon-16.png',
    './icon-32.png',
    './icon-48.png',
    './icon-96.png',
    './icon-128.png',
    './icon-180.png',
    './icon-192.png',
    './icon-384.png',
    './icon-512.png',
    // Referenced by the manifest's maskable icon entry; was missing from APP_SHELL
    // so it would 404 offline if never fetched while online.
    './maskable-512.png'
];

// P2-6: cache items individually instead of the atomic cache.addAll().
// addAll() is all-or-nothing: if ANY one asset 404s (e.g. someone deletes
// maskable-512.png), the entire install cache silently fails and there is no
// offline shell at all. Caching each URL independently means one missing icon
// degrades to "missing icon" instead of killing the whole offline mode.
self.addEventListener('install', (event) => {
    // Activate this worker immediately so deploys aren't stuck behind old tabs.
    self.skipWaiting();
    event.waitUntil(
        caches.open(CACHE_NAME).then((cache) =>
            Promise.all(APP_SHELL.map(u =>
                cache.add(u).catch(err => console.warn('[sw] install: failed to cache', u, err))
            ))
        )
    );
});

self.addEventListener('activate', (event) => {
    // Delete any older caches so stale app-shell files don't linger.
    event.waitUntil(
        caches.keys().then((keys) => Promise.all(
            keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k))
        )).then(() => self.clients.claim())
    );
});

/** True for same-origin GET requests to assets we want to cache-serve offline. */
function isCacheableRequest(request) {
    if (request.method !== 'GET') return false;
    try {
        const url = new URL(request.url);
        // Only intercept our own origin — leave cross-origin APIs alone.
        if (url.origin !== self.location.origin) return false;
        // Skip requests that explicitly ask for a fresh copy or are opaque redirects.
        const mode = request.mode;
        // B8: explicit extension list — the old MIME-type split logic produced
        // '.javascript' which never matched real .js files.
        if (mode === 'navigate' || ['css','js','png'].some(ext => url.pathname.endsWith('.' + ext))) {
            return true;
        }
        // Fall back: cache any same-origin GET that isn't an API call.
        const apiLike = /\/(api|v\d+|query)\b/.test(url.pathname);
        if (apiLike) return false;
        return true;
    } catch (e) {
        return false;
    }
}

self.addEventListener('fetch', (event) => {
    const req = event.request;
    if (!isCacheableRequest(req)) return; // let the browser handle it normally

    // Navigation + JS: network-first so deploys aren't stuck on stale cached scripts.
    // CSS/images stay cache-first below.
    const isJs = (() => {
        try { return new URL(req.url).pathname.endsWith('.js'); } catch (_) { return false; }
    })();
    if (req.mode === 'navigate' || isJs) {
        event.respondWith(
            fetch(req)
                .then(res => {
                    if (res && res.ok) {
                        const copy = res.clone();
                        const key = req.mode === 'navigate' ? './index.html' : req;
                        caches.open(CACHE_NAME).then(c => c.put(key, copy)).catch(() => {});
                    }
                    return res;
                })
                .catch(() => caches.match(req.mode === 'navigate' ? './index.html' : req)
                    .then(r => r || Response.error()))
        );
        return;
    }

    // Static assets: cache-first, then network (and populate the cache).
    event.respondWith(
        caches.match(req).then(cached => {
            if (cached) return cached;
            return fetch(req).then(res => {
                if (res && res.ok) {
                    const copy = res.clone();
                    caches.open(CACHE_NAME).then(c => c.put(req, copy)).catch(() => {});
                }
                return res;
            }).catch(() => Response.error());
        })
    );
});
