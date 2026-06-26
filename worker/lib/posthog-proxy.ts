// First-party reverse proxy for PostHog analytics. The production worker owns a
// second custom domain (e.news.justwallage.nl, see wrangler.jsonc); requests to
// that host are forwarded here to PostHog's EU ingestion so ad blockers — which
// match on *.posthog.com — don't drop the SPA's events. This path bypasses the
// Hono app entirely (no auth/CSRF/no-store headers): PostHog supplies its own
// CORS + cache headers, which we pass straight through.

const PROXY_HOST = "e.news.justwallage.nl";
const API_HOST = "eu.i.posthog.com";
const ASSETS_HOST = "eu-assets.i.posthog.com";

export const isPostHogProxyHost = (host: string): boolean =>
  host === PROXY_HOST;

// Static assets + remote config (the JS recorder, surveys, flag config) live on
// the assets host; everything else (event capture, /flags) is ingestion.
export function postHogTargetUrl(url: URL): URL {
  const target = new URL(url);
  target.protocol = "https:";
  target.port = "";
  target.hostname =
    url.pathname.startsWith("/static/") || url.pathname.startsWith("/array/")
      ? ASSETS_HOST
      : API_HOST;
  return target;
}

export function proxyPostHog(request: Request): Promise<Response> {
  const target = postHogTargetUrl(new URL(request.url));
  const proxied = new Request(target, request);
  // Cookies are this site's session, never PostHog's; drop them so the proxy
  // stays anonymous and the subrequest cache key is cookie-free.
  proxied.headers.delete("cookie");
  const clientIp = request.headers.get("CF-Connecting-IP");
  if (clientIp) {
    proxied.headers.set("X-Forwarded-For", clientIp);
  }
  return fetch(proxied);
}
