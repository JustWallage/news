import { and, isNotNull, lt, lte } from "drizzle-orm";
import { sessions, telegram } from "../../db/schema";
import type { Bindings } from "../env";
import type { Db } from "./db";
import { getDb } from "./db";

// Runs once a day on the */5 cron (this UTC hour, minute 0). Keeps the housekeep
// deletes off the hot path while bounding unbounded growth.
const PURGE_HOUR_UTC = 3;

// Delete sessions past their TTL and clear link codes past their expiry. Expired
// rows are already ignored at lookup/consume time; this just stops them piling
// up. Telegram rows are NOT deleted — only the stale code fields are cleared, so
// a linked chat (timezone, slots) survives.
export async function purgeExpired(db: Db, now: Date): Promise<void> {
  await db.delete(sessions).where(lte(sessions.expiresAt, now));
  await db
    .update(telegram)
    .set({ linkCode: null, linkCodeExpiresAt: null })
    .where(
      and(
        isNotNull(telegram.linkCodeExpiresAt),
        lt(telegram.linkCodeExpiresAt, now),
      ),
    );
}

// The cron tick is */5; run the daily purge only on the 03:00 UTC tick.
export async function runScheduledMaintenance(
  env: Bindings,
  now: Date,
): Promise<void> {
  if (now.getUTCHours() !== PURGE_HOUR_UTC || now.getUTCMinutes() !== 0) {
    return;
  }
  await purgeExpired(getDb(env), now);
}
