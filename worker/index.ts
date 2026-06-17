import { Hono } from "hono";
import { meSchema } from "../shared/api";
import type { AppEnv } from "./env";
import { createDeps } from "./lib/deps";
import { runScheduledDigest } from "./lib/scheduled";
import { authMiddleware } from "./middleware/auth";
import { digestRoutes } from "./routes/digest";
import { preferencesRoutes } from "./routes/preferences";
import { storiesRoutes } from "./routes/stories";

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

export default {
  fetch: app.fetch,
  scheduled: (_controller, env, ctx) => {
    ctx.waitUntil(runScheduledDigest(env));
  },
} satisfies ExportedHandler<Env>;
