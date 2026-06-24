import { eq, sql } from "drizzle-orm";
import { digestRuns } from "../../db/schema";
import type { Db } from "./db";

// Per-user cooldown on the expensive on-demand digest run (Workers AI curation).
// `cooldownMs` is driven by config (0 disables it, e.g. in local/e2e), so the
// check is uniform and carries no environment branch.

// Remaining cooldown in ms (0 when a run is allowed). A non-zero result means the
// user ran a digest within `cooldownMs` of `now`.
export async function digestCooldownRemainingMs(
  db: Db,
  userEmail: string,
  cooldownMs: number,
  now: Date,
): Promise<number> {
  if (cooldownMs <= 0) {
    return 0;
  }
  const rows = await db
    .select()
    .from(digestRuns)
    .where(eq(digestRuns.userEmail, userEmail))
    .limit(1);
  const last = rows[0]?.lastRunAt ?? null;
  if (last === null) {
    return 0;
  }
  const remaining = cooldownMs - (now.getTime() - last.getTime());
  return remaining > 0 ? remaining : 0;
}

// Stamp the user's last-run time (upsert) so the next call is rate-limited.
export async function recordDigestRun(
  db: Db,
  userEmail: string,
  now: Date,
): Promise<void> {
  await db
    .insert(digestRuns)
    .values({ userEmail, lastRunAt: now })
    .onConflictDoUpdate({
      target: digestRuns.userEmail,
      set: { lastRunAt: sql`excluded.last_run_at` },
    });
}
