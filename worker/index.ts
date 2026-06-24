import { Hono } from "hono";
import { secureHeaders } from "hono/secure-headers";
import { meSchema } from "../shared/api";
import type { AppEnv } from "./env";
import { createDeps } from "./lib/deps";
import { runScheduledMaintenance } from "./lib/maintenance";
import { runTelegramDigests } from "./lib/scheduled";
import { authMiddleware } from "./middleware/auth";
import { originGuard } from "./middleware/csrf";
import { authRoutes } from "./routes/auth";
import { digestRoutes } from "./routes/digest";
import { preferencesRoutes } from "./routes/preferences";
import { storiesRoutes } from "./routes/stories";
import { telegramRoutes } from "./routes/telegram";
import { telegramWebhookRoutes } from "./routes/telegram-webhook";

export const app = new Hono<AppEnv>();

// Hardening headers on every worker response (the SPA document + static assets
// carry the full CSP via public/_headers, since they are served by the assets
// handler and never reach the worker). HSTS is asserted here too.
app.use(
  "*",
  secureHeaders({
    strictTransportSecurity: "max-age=63072000; includeSubDomains; preload",
    xFrameOptions: "DENY",
    referrerPolicy: "strict-origin-when-cross-origin",
    contentSecurityPolicy: {
      defaultSrc: ["'none'"],
      frameAncestors: ["'none'"],
    },
  }),
);
// CSRF defence-in-depth (Origin check) on every state-changing request.
app.use("*", originGuard);

app.use("/api/*", authMiddleware);
// Root dependency injection: every /api handler reads its HN + AI deps from
// here (real in production, fakes otherwise) and stays environment-agnostic.
app.use("/api/*", (c, next) => {
  c.set("deps", createDeps(c.env));
  return next();
});

app.get("/api/health", (c) => c.json({ ok: true, email: c.get("userEmail") }));
app.get("/api/me", (c) =>
  c.json(meSchema.parse({ email: c.get("userEmail") })),
);
app.route("/api/stories", storiesRoutes);
app.route("/api/preferences", preferencesRoutes);
app.route("/api/digest", digestRoutes);
app.route("/api/telegram", telegramRoutes);

// The Google sign-in flow is intentionally NOT under /api: it must be reachable
// without a session (that is what it creates), so it sits outside the auth
// middleware. Same for the Telegram webhook below.
app.route("/auth", authRoutes);

// The Telegram webhook cannot present a session, so it sits outside the auth +
// deps middleware and is guarded by its own secret-token check (see the route).
app.route("/telegram", telegramWebhookRoutes);

export default {
  fetch: app.fetch,
  scheduled: (controller, env, ctx) => {
    const now = new Date(controller.scheduledTime);
    ctx.waitUntil(
      Promise.all([
        runTelegramDigests(env, now),
        runScheduledMaintenance(env, now),
      ]),
    );
  },
} satisfies ExportedHandler<Env>;
