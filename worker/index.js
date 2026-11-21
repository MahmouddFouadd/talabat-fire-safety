// Edge entry for the static site (Cloudflare Workers static assets).
// Runs only for /assets/* (see run_worker_first in wrangler.jsonc). Everything else is served
// straight from the asset store with the SPA fallback, exactly as before.
//
// Why: with not_found_handling = "single-page-application", a request for a file that does not
// exist (e.g. an old hashed chunk after a new deploy) gets index.html with status 200. The browser
// then refuses it as a module ("MIME type text/html") and lazy pages such as the inspection /
// offline queue fail to load. A missing asset must be a real 404 so the app can recover (reload).
export default {
  async fetch(request, env) {
    const res = await env.ASSETS.fetch(request);
    const url = new URL(request.url);
    const type = res.headers.get("Content-Type") || "";
    if (url.pathname.startsWith("/assets/") && type.startsWith("text/html")) {
      return new Response("Not found", {
        status: 404,
        headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" },
      });
    }
    return res;
  },
};
