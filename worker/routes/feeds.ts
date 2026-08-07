import { eq } from "drizzle-orm";
import { Hono } from "hono";
import type { Context } from "hono";
import { feeds, type FeedRow } from "../../db/schema";
import {
  digestRunResultSchema,
  feedCreateSchema,
  feedCreatedSchema,
  feedDetailSchema,
  feedItemListSchema,
  feedListSchema,
  feedSourceCreateSchema,
  feedSourceItemListSchema,
  feedSourceSchema,
  feedSummarySchema,
  feedUpdateSchema,
  telegramSlotsUpdateSchema,
} from "../../shared/api";
import type { AppEnv } from "../env";
import { getDb } from "../lib/db";
import {
  addFeedSource,
  createFeed,
  deleteFeed,
  loadFeedArchive,
  loadFeedForUser,
  loadFeedItems,
  loadFeedSources,
  loadFeeds,
  loadSourceCounts,
  loadSourceItems,
  markFeedItemOpened,
  removeFeedSource,
  runFeedFetch,
  updateFeed,
} from "../lib/feeds";
import { parseJsonBody } from "../lib/http";
import { toFeedItem, toFeedSourceItem } from "../lib/serialize";
import { formatSlots, loadChatId, slotMinutes } from "../lib/telegram-bot";

export const feedsRoutes = new Hono<AppEnv>();

// Every /:id route resolves the feed through the ownership gate: an unknown id
// and another user's feed are both 404.
async function requireFeed(c: Context<AppEnv>): Promise<FeedRow | Response> {
  const feedId = Number(c.req.param("id"));
  if (!Number.isInteger(feedId) || feedId <= 0) {
    return c.json({ error: "Invalid feed id" }, 400);
  }
  const feed = await loadFeedForUser(getDb(c.env), c.get("userEmail"), feedId);
  return feed ?? c.json({ error: "Feed not found" }, 404);
}

feedsRoutes.get("/", async (c) => {
  const rows = await loadFeeds(getDb(c.env), c.get("userEmail"));
  return c.json(
    feedListSchema.parse({
      feeds: rows.map((row) =>
        feedSummarySchema.parse({
          id: row.id,
          title: row.title,
          preferencesText: row.preferencesText,
        }),
      ),
    }),
  );
});

feedsRoutes.post("/", async (c) => {
  const parsed = feedCreateSchema.safeParse(await parseJsonBody(c.req.raw));
  if (!parsed.success) {
    return c.json({ error: "Invalid request body" }, 400);
  }
  const id = await createFeed(
    getDb(c.env),
    c.get("userEmail"),
    parsed.data.title,
    new Date(),
  );
  return c.json(feedCreatedSchema.parse({ id }));
});

feedsRoutes.get("/:id", async (c) => {
  const feed = await requireFeed(c);
  if (feed instanceof Response) {
    return feed;
  }
  const db = getDb(c.env);
  const sources = await loadFeedSources(db, feed.id);
  const counts = await loadSourceCounts(db, feed.id);
  const chatId = await loadChatId(db, c.get("userEmail"));
  return c.json(
    feedDetailSchema.parse({
      id: feed.id,
      title: feed.title,
      preferencesText: feed.preferencesText,
      sources: sources.map((s) =>
        feedSourceSchema.parse({
          id: s.id,
          url: s.url,
          title: s.title,
          fetchedCount: counts.get(s.id)?.fetched ?? 0,
          selectedCount: counts.get(s.id)?.selected ?? 0,
        }),
      ),
      slots: formatSlots(feed),
      telegramLinked: chatId !== null,
      lastFetchedAt: feed.lastFetchedAt?.toISOString() ?? null,
    }),
  );
});

feedsRoutes.put("/:id", async (c) => {
  const feed = await requireFeed(c);
  if (feed instanceof Response) {
    return feed;
  }
  const parsed = feedUpdateSchema.safeParse(await parseJsonBody(c.req.raw));
  if (!parsed.success) {
    return c.json({ error: "Invalid request body" }, 400);
  }
  await updateFeed(getDb(c.env), feed, parsed.data);
  return c.json({ ok: true });
});

feedsRoutes.delete("/:id", async (c) => {
  const feed = await requireFeed(c);
  if (feed instanceof Response) {
    return feed;
  }
  await deleteFeed(getDb(c.env), feed.id);
  return c.json({ ok: true });
});

// The feed's daily-digest times; like /api/telegram/slots they only make sense
// (and are only accepted) once a chat is linked.
feedsRoutes.put("/:id/slots", async (c) => {
  const feed = await requireFeed(c);
  if (feed instanceof Response) {
    return feed;
  }
  const db = getDb(c.env);
  if ((await loadChatId(db, c.get("userEmail"))) === null) {
    return c.json({ error: "Telegram is not connected" }, 409);
  }
  const parsed = telegramSlotsUpdateSchema.safeParse(
    await parseJsonBody(c.req.raw),
  );
  if (!parsed.success) {
    return c.json({ error: "Invalid request body" }, 400);
  }
  await db
    .update(feeds)
    .set(slotMinutes(parsed.data.slots))
    .where(eq(feeds.id, feed.id));
  return c.json({ ok: true });
});

feedsRoutes.post("/:id/sources", async (c) => {
  const feed = await requireFeed(c);
  if (feed instanceof Response) {
    return feed;
  }
  const parsed = feedSourceCreateSchema.safeParse(
    await parseJsonBody(c.req.raw),
  );
  if (!parsed.success) {
    return c.json({ error: "Enter a valid http(s) URL" }, 400);
  }
  const result = await addFeedSource(
    getDb(c.env),
    c.get("deps").rss,
    feed,
    parsed.data.url,
    new Date(),
  );
  if (!result.ok) {
    return c.json(
      { error: result.message },
      result.reason === "unreachable" ? 400 : 409,
    );
  }
  return c.json(
    feedSourceSchema.parse({
      id: result.source.id,
      url: result.source.url,
      title: result.source.title,
      fetchedCount: 0,
      selectedCount: 0,
    }),
  );
});

function sourceIdParam(c: Context<AppEnv>): number | Response {
  const sourceId = Number(c.req.param("sourceId"));
  if (!Number.isInteger(sourceId) || sourceId <= 0) {
    return c.json({ error: "Invalid source id" }, 400);
  }
  return sourceId;
}

feedsRoutes.delete("/:id/sources/:sourceId", async (c) => {
  const feed = await requireFeed(c);
  if (feed instanceof Response) {
    return feed;
  }
  const sourceId = sourceIdParam(c);
  if (sourceId instanceof Response) {
    return sourceId;
  }
  await removeFeedSource(getDb(c.env), feed.id, sourceId);
  return c.json({ ok: true });
});

// What this source contributed: its stored items with the AI's verdict, so the
// settings page can show fetched-vs-selected without a second round trip.
feedsRoutes.get("/:id/sources/:sourceId/items", async (c) => {
  const feed = await requireFeed(c);
  if (feed instanceof Response) {
    return feed;
  }
  const sourceId = sourceIdParam(c);
  if (sourceId instanceof Response) {
    return sourceId;
  }
  const rows = await loadSourceItems(getDb(c.env), feed.id, sourceId);
  return c.json(
    feedSourceItemListSchema.parse({ items: rows.map(toFeedSourceItem) }),
  );
});

feedsRoutes.get("/:id/items", async (c) => {
  const feed = await requireFeed(c);
  if (feed instanceof Response) {
    return feed;
  }
  const rows = await loadFeedItems(getDb(c.env), feed.id);
  return c.json(
    feedItemListSchema.parse({
      items: rows.map(toFeedItem),
      lastFetchedAt: feed.lastFetchedAt?.toISOString() ?? null,
    }),
  );
});

// Record the first time the user opens an item; idempotent (later opens no-op).
feedsRoutes.post("/:id/items/:itemId/open", async (c) => {
  const feed = await requireFeed(c);
  if (feed instanceof Response) {
    return feed;
  }
  const itemId = Number(c.req.param("itemId"));
  if (!Number.isInteger(itemId) || itemId <= 0) {
    return c.json({ error: "Invalid item id" }, 400);
  }
  const found = await markFeedItemOpened(
    getDb(c.env),
    feed.id,
    itemId,
    new Date(),
  );
  return found
    ? c.json({ ok: true })
    : c.json({ error: "Item not found" }, 404);
});

feedsRoutes.get("/:id/archive", async (c) => {
  const feed = await requireFeed(c);
  if (feed instanceof Response) {
    return feed;
  }
  const rows = await loadFeedArchive(getDb(c.env), feed.id);
  return c.json(
    feedItemListSchema.parse({
      items: rows.map(toFeedItem),
      lastFetchedAt: feed.lastFetchedAt?.toISOString() ?? null,
    }),
  );
});

// On-demand fetch+curate for one feed (the feed page's Refresh). Rate-limited
// per feed off lastFetchedAt — same budget-bounding idea as /api/digest/run,
// without a separate runs table. The cron path bypasses this (it calls
// runFeedFetch directly).
feedsRoutes.post("/:id/run", async (c) => {
  const feed = await requireFeed(c);
  if (feed instanceof Response) {
    return feed;
  }
  const now = new Date();
  const cooldownMs = c.env.DIGEST_COOLDOWN_SECONDS * 1000;
  const remaining =
    feed.lastFetchedAt === null
      ? 0
      : cooldownMs - (now.getTime() - feed.lastFetchedAt.getTime());
  if (remaining > 0) {
    return c.json({ error: "Too many requests" }, 429, {
      "Retry-After": String(Math.ceil(remaining / 1000)),
    });
  }
  const result = await runFeedFetch(getDb(c.env), c.get("deps"), feed, now);
  return c.json(digestRunResultSchema.parse({ count: result.count }));
});
