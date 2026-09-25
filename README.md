# Personal Dashboard

A local-first, installable (PWA) dashboard for your daily life: shortcuts, todo lists, world clock, weather, notes, stock watchlist, search launcher, countdowns, **RSS feeds**, Pomodoro timer, currency rates, and habit tracking.

- **No build step** — it's a static site you can host anywhere (runtime has no npm dependencies; eslint/tests are optional and for development only).
- **Local-first** — all data lives in your browser (localStorage + IndexedDB). Nothing is sent to any server except the public APIs each widget uses.
- **Installable PWA** — add it to your home screen / desktop once served over HTTP(S).

---

## Install & run locally

Requirements: a modern browser (Chrome, Edge, Firefox, or Safari) and Python 3 *or* Node.js for a local server. That's it.

```bash
# 1. Get the code
git clone <your-repo-url> dashboard   # or just copy the folder anywhere

cd dashboard

# 2a. Serve with Python (easiest, no install needed)
python3 -m http.server 8080

# — or — 2b. Serve with Node
npx serve .
```

Then open **http://localhost:8080** in your browser.

> **Why not just double-click `index.html`?** The app *works* from `file://`, but browsers refuse to register a service worker without a secure context, so the PWA/offline features are skipped (see [app/boot.js](app/boot.js), SW registration guard). Serving over HTTP(S) is the supported path for installable / offline use.

**Support matrix**

| Mode | Core UI | PWA / offline shell | Live widgets (weather, stocks, RSS…) |
|---|---|---|---|
| Open `index.html` (`file://`) | Yes | No (SW skipped) | Yes, subject to browser CORS |
| `http://localhost` / hosted HTTPS | Yes | Yes | Yes |

Runtime has **zero npm dependencies**. Dev tooling (`eslint`, `node --test`) is optional and never loaded by the page.

### Installing as an app (PWA)

1. Serve it over `http://` or `https://` as above.
2. In Chrome/Edge: address-bar icon → **Install** / *Save and share* → *Install page as app*. In Safari: Share → **Add to Home Screen**. On desktop Linux, your browser's "Install" menu.
3. It launches in its own window with the dashboard icon and works offline (app shell is cached by [sw.js](sw.js); live data still needs network).

### Hosting it for real

Any static host works — GitHub Pages, Netlify, Cloudflare Pages, a home server, etc. Just upload/copy all files as-is; there's nothing to build. If you deploy updates, see the **Troubleshooting** note about the service-worker cache below.

---

## Configuration

All configuration is done in-app via the **Settings (⚙)** button — no config files. Settings persist locally and are included in JSON exports.

### General appearance & layout

| Setting | Notes |
|---|---|
| Dashboard title | Shown in the header. |
| Theme | `System`, `Light`, or `Dark`. |
| Layout columns / UI scale | Grid density (auto or 3–6 fixed); UI scale ranges 75–125%. |
| Header color & opacity | Tint and transparency of the top bar. |
| Background image | By **URL** or by **upload**. Uploads are stored in IndexedDB (not bloated into localStorage). Overlay **opacity** and **blur** sliders dim/soften it behind the cards. |

### Stocks & APIs

| Setting | Notes |
|---|---|
| **Twelve Data API key** | Required for the Stock Watchlist widget. Free keys at [twelvedata.com](https://www.twelvedata.com). Stored locally only — never sent anywhere except Twelve Data's own API. |
| Stock link URL template | Where clicking a stock name goes; use `{ticker}` as the placeholder, e.g. `https://www.google.com/finance/beta/quote/{ticker}`. Blank = default (Google Finance). |

### RSS / CORS proxy

See [RSS feeds & the Cloudflare proxy](#rss-feeds--the-cloudflare-proxy) below — this is where you paste your proxy URL once it's deployed.

### Data management

- **Export JSON** — full backup of widgets, settings, and data.
- **Import JSON** — restore a backup (imported payloads are sanitized before use).
- **Reset Dashboard** — wipes local state back to the seeded starter layout. There is no server-side copy; if you don't export it, it's gone when you clear site data.

### Widget quick-reference

| Widget | Data source / setup |
|---|---|
| Shortcuts | Your own links (label + URL), "most used" ordering tracked locally. |
| Lists / Todo | Local only; optional due dates and completed-item visibility. |
| World Clock | IANA timezones, e.g. `America/New_York`. No API needed. |
| Weather | [Open-Meteo](https://open-meteo.com) — keyless. Falls back to browser geolocation if you don't set a city/coordinates (graceful message on denial). |
| Notes | Local only, autosaved as you type. |
| Stocks | Twelve Data API — add your free key in Settings first, then tickers like `AAPL`. |
| Search launcher | Pick an engine; opens results in same or new tab. |
| Countdowns | Your own dates/events (stored locally). |
| RSS / News | Feed URLs — many public feeds are CORS-blocked; see proxy setup below. |
| Pomodoro | Local timer with focus/break cycles and session counter. |
| Currency converter | [frankfurter.dev](https://frankfurter.dev) v1 (ECB rates) — keyless. Base currency + target codes in the widget's edit page. |
| Habit tracker | Local habits + daily log; toggle from the card, manage in the edit page. |

### Keyboard shortcuts

| Key | Action |
|---|---|
| `⌘K` / `Ctrl+K` | Open the command palette (jump to a widget or open a shortcut link). |
| `/` | Focus the search input (when not already in an input field). |
| `↑↓←→` on a card's drag handle | Reorder the widget without dragging. Focus the handle (Tab to it), then use arrow keys; `Enter`/`Space` commits. |
| `Esc` | Close the command palette or any open modal. |

---

## RSS feeds & the Cloudflare proxy

### Why you need a proxy

The browser enforces **CORS**: an `RSS`/`News` feed served by another domain usually doesn't send `Access-Control-Allow-Origin`, so a direct fetch from your dashboard is blocked. The app copes in this order (see [widgets/rss.js](widgets/rss.js), `buildProxyStrategies`):

1. **Direct fetch** of the feed URL;
2. **Your proxy**, if you set one in *Settings → CORS Proxy URL*;
3. *(Opt-in only)* A few well-known public proxies (`allorigins`, `corsproxy.io`, `codetabs`) — enabled via the **"Allow third-party public proxies for RSS"** checkbox in Settings. Default: off.

Relying on step 3 is the worst experience: slow, flaky, and your feed URLs pass through strangers' servers. **The recommended setup is a tiny Cloudflare Worker you own.** It takes ~5 minutes and makes RSS reliable forever.

### Step 1 — Create the worker project

```bash
mkdir rss-proxy && cd rss-proxy
```

**`worker.js`**

```js
/**
 * Minimal CORS proxy for RSS feeds, built for Personal Dashboard.
 * Usage: GET /feed?url=<encoded http(s) feed URL>
 */
export default {
  async fetch(request) {
    const url = new URL(request.url);
    if (url.pathname !== '/feed') {
      return new Response('Not found', { status: 404 });
    }

    // Only allow http(s) targets — never let this be an open relay for file://, gopher:, etc.
    const target = url.searchParams.get('url');
    if (!target || !/^https?:\/\//i.test(target)) {
      return new Response('Missing or invalid ?url= parameter (must be http/https).', { status: 400 });
    }

    try {
      const upstream = await fetch(target, { redirect: 'follow' });
      const body = await upstream.arrayBuffer();

      // Strip the upstream's cache headers so feeds don't go stale behind us.
      return new Response(body, {
        status: upstream.status,
        headers: {
          'access-control-allow-origin': '*',
          'content-type': upstream.headers.get('content-type') || 'application/xml; charset=utf-8',
          'cache-control': 'no-store',
        },
      });
    } catch (err) {
      return new Response(`Upstream fetch failed: ${err.message}`, { status: 502 });
    }
  },
};
```

**`wrangler.toml`**

```toml
name = "rss-proxy"
main = "worker.js"
compatibility_date = "2024-09-01"
```

### Step 2 — Deploy it

You need a free [Cloudflare](https://dash.cloudflare.com) account. From the `rss-proxy` folder:

```bash
npx wrangler login        # opens browser, authorizes once
npx wrangler deploy       # prints your public URL, e.g. https://rss-proxy.<you>.workers.dev
```

To iterate locally before deploying: `npx wrangler dev`, then test with

```bash
curl -i "http://localhost:8787/feed?url=https%3A%2F%2Flwn.net%2Frss"
# expect 200 + access-control-allow-origin: * + the XML body
```

### Step 3 — Point the dashboard at it

In **Settings → CORS Proxy URL**, paste (substituting your worker's host):

```
https://rss-proxy.<you>.workers.dev/feed?url={url}
```

The `{url}` placeholder is where the app injects each feed's encoded URL. (A plain base URL with no placeholder also works — the app appends `?url=<encoded>` itself.) Save, then add feeds in an **RSS/News** widget → *Edit*.

### Optional hardening for your worker

Your worker is now a public endpoint that fetches arbitrary URLs on demand. For personal use this is fine, but if you want to be tidy:

- **Allowlist domains**: keep an array of feed hosts (e.g. `lwn.net`, `hnrss.org`) and reject anything else with 403 — turns your open relay into a private one in ~5 lines.
- **Rate limit / auth**: add a shared secret query param (`?key=…`) checked first, or use Cloudflare's built-in rate-limiting rules on the route.

---

## Data & privacy

| What | Where it lives |
|---|---|
| Widgets, settings, lists, notes, habits, countdowns | Browser **localStorage** (JSON, versioned with migrations) |
| Uploaded background image | Browser **IndexedDB** (kept out of the localStorage quota) |
| Twelve Data API key | localStorage — sent only to `api.twelvedata.com` |
| Anything else | Nowhere. Weather/currency/search APIs are called directly from your browser; no backend of ours exists. |

Treat an exported JSON file as a personal document: it contains your notes, lists, and the API key.

## Troubleshooting

- **RSS card stuck on "Loading…" or errors** — check *Settings → CORS Proxy URL* is set (see above); verify with `curl` that your worker returns 200 for one of your feeds; otherwise the feed host may be down or blocking bots.
- **Stocks widget empty** — no Twelve Data key saved yet, or a free-tier rate limit; add/verify the key in Settings and refresh the card (↻).
- **Weather shows "Your Location" prompt** — geolocation was denied; set an explicit city or coordinates on the widget's edit page.
- **UI looks stale after you deploy new code** — see the [Deploy checklist](#deploy-checklist) below.
- **PWA won't install** — you're probably opening via `file://`; serve over HTTP(S) as described above.

## Deploy checklist

The service worker ([sw.js](sw.js)) caches the app shell **cache-first** and only swaps when `CACHE_NAME` changes. If you deploy new JS/CSS without bumping the version, PWA/HTTP users will keep getting stale code from cache. **Every release:**

1. **Bump** `CACHE_NAME` in [sw.js](sw.js) (e.g. `'personal-dashboard-v3'` → `'personal-dashboard-v4'`).
2. **Deploy** the updated files to your host.
3. **Hard-refresh once** (⌘⇧R / Ctrl+Shift+R) so the browser fetches the new `sw.js` and triggers a re-install. The old cache is garbage-collected automatically by the worker's `activate` handler.

> **Why this matters:** a v1→v2 incident (see [CHANGELOG.md](CHANGELOG.md)) showed that stale cached JS can cause "Unknown widget type" regressions for PWA users. The bump is one line; skipping it costs a support round.

## Project layout

| File / folder | Purpose |
|---|---|
| [index.html](index.html) | App shell: header, grid, modals, command palette markup |
| [app/](app/) | Boot/state, settings & edit modals, drag-and-drop reorder, command palette, toasts/undo |
| [widgets/](widgets/) | One file per widget type + shared helpers (escaping, sparkline, timer registry) and the RSS fetch pipeline |
| [registry.js](registry.js) | `WidgetRegistry` — per-type defaults, edit UI, sanitization; adding a type starts here |
| [storage.js](storage.js) | localStorage/IndexedDB persistence, version migrations, import/export/reset |
| [sw.js](sw.js) | Service worker: app-shell caching for offline/PWA use |
| [style.css](style.css) | Theming (CSS variables + `data-theme`) and all component styles |
| [manifest.webmanifest](manifest.webmanifest), icons | PWA metadata and install icons |
| [test/](test/) | Dev-only unit tests (Node's built-in runner); never loaded by the page |
| [CHANGELOG.md](CHANGELOG.md) | Notable change history (SW incidents, architecture decisions) |
