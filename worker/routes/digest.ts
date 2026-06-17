import { Hono } from "hono";
import type { AppEnv } from "../env";
import { getDb } from "../lib/db";
import { loadPreferences, runDigest } from "../lib/digest";

export const digestRoutes = new Hono<AppEnv>();

// Runs the digest for the signed-in user — the homepage Refresh button, the
// 06:20 cron, and e2e all go through this. Deps come from the root injection
// (`c.var.deps`), so production uses real HN + Workers AI while local/e2e use
// fakes; the handler itself is environment-agnostic.
digestRoutes.post("/run", async (c) => {
  const db = getDb(c.env);
  const userEmail = c.get("userEmail");
  const prefs = await loadPreferences(db, userEmail);
  const result = await runDigest(
    db,
    c.get("deps"),
    prefs,
    userEmail,
    new Date(),
  );
  return c.json({ count: result.count });
});
