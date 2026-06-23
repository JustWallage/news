import { Hono } from "hono";
import { digestRunResultSchema } from "../../shared/api";
import type { AppEnv } from "../env";
import { getDb } from "../lib/db";
import { loadPreferences, runDigest } from "../lib/digest";
import { digestCooldownRemainingMs, recordDigestRun } from "../lib/rate-limit";

export const digestRoutes = new Hono<AppEnv>();

// Runs the digest for the signed-in user — the homepage Refresh button and the
// Telegram /fetch both re-curate a feed, but this on-demand web path is the one
// open to abuse, so it carries a per-user cooldown (DIGEST_COOLDOWN_SECONDS; 0
// disables it in local/e2e) that bounds the expensive Workers AI curation. Deps
// come from the root injection, so production uses real HN + Workers AI while
// local/e2e use fakes; the handler itself stays environment-agnostic.
digestRoutes.post("/run", async (c) => {
  const db = getDb(c.env);
  const userEmail = c.get("userEmail");
  const now = new Date();
  const cooldownMs = c.env.DIGEST_COOLDOWN_SECONDS * 1000;
  const remaining = await digestCooldownRemainingMs(
    db,
    userEmail,
    cooldownMs,
    now,
  );
  if (remaining > 0) {
    return c.json({ error: "Too many requests" }, 429, {
      "Retry-After": String(Math.ceil(remaining / 1000)),
    });
  }
  const prefs = await loadPreferences(db, userEmail);
  const result = await runDigest(
    db,
    c.get("deps"),
    prefs.text,
    prefs.version,
    userEmail,
    now,
  );
  await recordDigestRun(db, userEmail, now);
  return c.json(digestRunResultSchema.parse({ count: result.count }));
});
