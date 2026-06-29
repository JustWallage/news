import { and, isNotNull, or } from "drizzle-orm";
import { telegram, type TelegramRow } from "../../db/schema";
import type { Bindings } from "../env";
import type { Db } from "./db";
import { getDb } from "./db";
import { createDeps, type Deps } from "./deps";
import {
  curateForUser,
  fetchFrontPage,
  loadPreferences,
  runDigest,
} from "./digest";
import { loadFeed } from "./feed";
import { formatDigestMessage } from "./telegram";
import { dueSlot } from "./telegram-bot";
import { minuteOfDayInTz } from "./time";

// Push the user's curated feed to their Telegram chat. Used by the Telegram
// /fetch command (a single-user on-demand run). With `recurate` (the default) it
// re-runs the Workers AI pass first; a /fetch throttled by the shared cooldown
// passes `recurate: false` to send the existing curations as-is. Deps are
// injected so a recording client can assert the send.
export async function sendDailyDigest(
  db: Db,
  deps: Deps,
  userEmail: string,
  chatId: number,
  appUrl: string,
  now: Date,
  recurate = true,
): Promise<void> {
  if (recurate) {
    const prefs = await loadPreferences(db, userEmail);
    await runDigest(db, deps, prefs.text, prefs.version, userEmail, now);
  }
  const feed = await loadFeed(db, userEmail);
  await deps.telegram.sendMessage(chatId, formatDigestMessage(feed, appUrl));
}

type LinkedRow = TelegramRow & { chatId: number };

// The */5 heartbeat core. Sends a summary to every user whose configured slot
// matches the current minute in their own timezone (Europe/Amsterdam when
// unset) — so the due check is per-row in JS, not a single SQL minute filter.
// HN is queried at most once per tick — only when ≥1 user is due — and the
// shared front page is then evaluated and delivered to each due user in
// parallel. Deps are injected for testing.
export async function sendDueDigests(
  db: Db,
  deps: Deps,
  appUrl: string,
  now: Date,
): Promise<void> {
  const linked = await db
    .select()
    .from(telegram)
    .where(
      and(
        isNotNull(telegram.chatId),
        or(
          isNotNull(telegram.slot1),
          isNotNull(telegram.slot2),
          isNotNull(telegram.slot3),
        ),
      ),
    );
  const due = linked.filter(
    (row): row is LinkedRow =>
      row.chatId !== null &&
      dueSlot(row, minuteOfDayInTz(now, row.timezone ?? "Europe/Amsterdam")),
  );
  if (due.length === 0) {
    return;
  }
  const candidates = await fetchFrontPage(db, deps.hn, now);
  await Promise.all(
    due.map(async (row) => {
      const prefs = await loadPreferences(db, row.userEmail);
      await curateForUser(
        db,
        deps.ai,
        candidates,
        prefs.text,
        prefs.version,
        row.userEmail,
        now,
      );
      const feed = await loadFeed(db, row.userEmail);
      await deps.telegram.sendMessage(
        row.chatId,
        formatDigestMessage(feed, appUrl),
      );
    }),
  );
}

export async function runTelegramDigests(
  env: Bindings,
  now: Date,
): Promise<void> {
  await sendDueDigests(getDb(env), createDeps(env), env.APP_URL, now);
}
