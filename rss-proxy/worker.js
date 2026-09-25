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