import { eq } from "drizzle-orm";
import { telegram } from "../../db/schema";
import type { Bindings } from "../env";
import type { Db } from "./db";
import { getDb } from "./db";
import { createDeps, type Deps } from "./deps";
import { loadPreferences, runDigest } from "./digest";
import { loadFeed } from "./feed";
import { formatDigestMessage } from "./telegram";
import { dueSlot } from "./telegram-bot";
import { amsterdamHour, amsterdamMinuteOfDay } from "./time";

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

// Re-run the digest for the user, then push the freshly curated feed to their
// Telegram chat. Deps are injected so a recording client can assert the send.
export async function sendDailyDigest(
  db: Db,
  deps: Deps,
  userEmail: string,
  chatId: number,
  appUrl: string,
  now: Date,
): Promise<void> {
  const prefs = await loadPreferences(db, userEmail);
  await runDigest(db, deps, prefs, userEmail, now);
  const feed = await loadFeed(db, userEmail);
  await deps.telegram.sendMessage(chatId, formatDigestMessage(feed, appUrl));
}

// The */5 heartbeat: send a Telegram summary only when the current Amsterdam
// minute matches one of the owner's configured slots (so each slot fires once
// per day). Off-slot wakes are a single indexed read and an early return.
export async function runTelegramDigests(
  env: Bindings,
  now: Date,
): Promise<void> {
  const owner = env.ALLOWED_EMAILS.split(",")[0]?.trim() ?? "";
  if (owner === "") {
    return;
  }
  const db = getDb(env);
  const rows = await db
    .select()
    .from(telegram)
    .where(eq(telegram.userEmail, owner))
    .limit(1);
  const row = rows[0];
  if (row?.chatId == null) {
    return;
  }
  if (!dueSlot(row, amsterdamMinuteOfDay(now))) {
    return;
  }
  await sendDailyDigest(
    db,
    createDeps(env),
    owner,
    row.chatId,
    env.APP_URL,
    now,
  );
}
