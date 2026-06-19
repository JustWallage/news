import { Hono } from "hono";
import { meSchema } from "../shared/api";
import type { AppEnv } from "./env";
import { createDeps } from "./lib/deps";
import { runScheduledDigest, runTelegramDigests } from "./lib/scheduled";
import { authMiddleware } from "./middleware/auth";
import { digestRoutes } from "./routes/digest";
import { preferencesRoutes } from "./routes/preferences";
import { storiesRoutes } from "./routes/stories";
import { telegramRoutes } from "./routes/telegram";
import { telegramWebhookRoutes } from "./routes/telegram-webhook";

const TELEGRAM_CRON = "*/5 * * * *";

export const app = new Hono<AppEnv>();

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

// The Telegram webhook is intentionally NOT under /api: Telegram cannot present
// a CF Access identity, so it sits outside the auth + deps middleware and is
// guarded by its own secret-token check (see the route).
app.route("/telegram", telegramWebhookRoutes);

export default {
  fetch: app.fetch,
  scheduled: (controller, env, ctx) => {
    const run =
      controller.cron === TELEGRAM_CRON
        ? runTelegramDigests(env, new Date(controller.scheduledTime))
        : runScheduledDigest(env);
    ctx.waitUntil(run);
  },
} satisfies ExportedHandler<Env>;
