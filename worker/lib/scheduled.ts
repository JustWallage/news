import type { Bindings } from "../env";
import { getDb } from "./db";
import { createDeps } from "./deps";
import { loadPreferences, runDigest } from "./digest";
import { amsterdamHour } from "./time";

// The cron fires at two fixed UTC times (04:20 + 05:20) so that exactly one of
// them is 06:xx Amsterdam time year-round; the other is skipped here. Runs the
// digest for the owner (the first ALLOWED_EMAILS entry).
export async function runScheduledDigest(env: Bindings): Promise<void> {
  const now = new Date();
  if (amsterdamHour(now) !== 6) {
    return;
  }
  const owner = env.ALLOWED_EMAILS.split(",")[0]?.trim() ?? "";
  if (owner === "") {
    return;
  }
  const db = getDb(env);
  const prefs = await loadPreferences(db, owner);
  await runDigest(db, createDeps(env), prefs, owner, now);
}
