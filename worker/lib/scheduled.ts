import { and, eq, isNotNull, or } from "drizzle-orm";
import { feeds, telegram, type TelegramRow } from "../../db/schema";
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
import { loadUnsentFeedItems, markFeedItemsSent, runFeedFetch } from "./feeds";
import { toFeedItem } from "./serialize";
import {
  MAX_STORIES,
  formatDigestMessage,
  formatFeedDigestMessage,
} from "./telegram";
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

// Per-feed daily digests: a feed is due when any of ITS slots matches the
// current minute in its OWNER's telegram timezone. Each due feed is refetched
// and re-curated, then only its never-sent current items go out (send-once —
// `sentAt` is stamped on exactly the delivered items; the overflow beyond the
// message cap stays unsent and rolls over to the next slot). Feeds run
// SEQUENTIALLY: one cron tick shares the 50-subrequest cap across all due
// feeds + HN digests, so a later feed exhausting the budget can't take the
// earlier ones down with it.
export async function sendDueFeedDigests(
  db: Db,
  deps: Deps,
  appUrl: string,
  now: Date,
): Promise<void> {
  const rows = await db
    .select({
      feed: feeds,
      chatId: telegram.chatId,
      timezone: telegram.timezone,
    })
    .from(feeds)
    .innerJoin(telegram, eq(feeds.userEmail, telegram.userEmail))
    .where(
      and(
        isNotNull(telegram.chatId),
        or(
          isNotNull(feeds.slot1),
          isNotNull(feeds.slot2),
          isNotNull(feeds.slot3),
        ),
      ),
    );
  const due = rows.filter(
    (row) =>
      row.chatId !== null &&
      dueSlot(
        row.feed,
        minuteOfDayInTz(now, row.timezone ?? "Europe/Amsterdam"),
      ),
  );
  for (const row of due) {
    if (row.chatId === null) {
      continue;
    }
    try {
      await runFeedFetch(db, deps, row.feed, now);
      const unsent = await loadUnsentFeedItems(db, row.feed.id);
      const shown = unsent.slice(0, MAX_STORIES);
      await deps.telegram.sendMessage(
        row.chatId,
        formatFeedDigestMessage(row.feed.title, shown.map(toFeedItem), appUrl),
      );
      await markFeedItemsSent(
        db,
        shown.map((item) => item.id),
        now,
      );
    } catch (error) {
      console.warn(
        `[feeds] scheduled digest for feed ${String(row.feed.id)} failed: ${String(error)}`,
      );
    }
  }
}

export async function runTelegramDigests(
  env: Bindings,
  now: Date,
): Promise<void> {
  const db = getDb(env);
  const deps = createDeps(env);
  await sendDueDigests(db, deps, env.APP_URL, now);
  await sendDueFeedDigests(db, deps, env.APP_URL, now);
}
