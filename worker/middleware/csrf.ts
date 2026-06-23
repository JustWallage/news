import { createMiddleware } from "hono/factory";

const SAFE_METHOD = /^(GET|HEAD|OPTIONS)$/;

// Defence-in-depth against CSRF, layered on the SameSite=Lax session cookie: for
// unsafe methods, reject a request whose Origin header is present but does not
// match this worker's own origin (a cross-site browser request). A MISSING Origin
// is allowed — browsers always send it on cross-origin state-changing requests,
// so its absence means a same-origin caller or a non-browser client (which has no
// ambient cookie to abuse). The Telegram webhook (server-to-server, no Origin) is
// unaffected; it is gated by its own secret token.
export const originGuard = createMiddleware(async (c, next) => {
  if (!SAFE_METHOD.test(c.req.method)) {
    const origin = c.req.header("Origin");
    if (origin !== undefined && origin !== new URL(c.req.url).origin) {
      return c.json({ error: "Forbidden" }, 403);
    }
  }
  return next();
});
