import { and, asc, count, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import {
  feedItems,
  feedSources,
  feeds,
  type FeedItemRow,
  type FeedRow,
  type FeedSourceRow,
} from "../../db/schema";
import { MAX_FEED_SOURCES } from "../../shared/api";
import { chunk } from "./chunk";
import type { Db } from "./db";
import type { AiFilter, DigestResult } from "./digest";
import type { ParsedFeedItem, RssClient } from "./rss";

// D1 caps a query at 100 bound parameters; feed_items upserts bind 11 columns
// (sentAt is preserved by omission) → 9 rows/insert stays under it.
const ITEM_CHUNK = 9;
const PAGE_SIZE = 20;
// The settings drill-down lists one source's items; a long-lived source
// accumulates without bound, so the modal shows the newest slice.
const SOURCE_ITEM_LIMIT = 100;

export async function loadFeeds(db: Db, userEmail: string): Promise<FeedRow[]> {
  return db
    .select()
    .from(feeds)
    .where(eq(feeds.userEmail, userEmail))
    .orderBy(asc(feeds.createdAt), asc(feeds.id));
}

export async function createFeed(
  db: Db,
  userEmail: string,
  title: string,
  now: Date,
): Promise<number> {
  const rows = await db
    .insert(feeds)
    .values({ userEmail, title, createdAt: now })
    .returning({ id: feeds.id });
  const id = rows[0]?.id;
  if (id === undefined) {
    throw new Error("feed insert returned no id");
  }
  return id;
}

// The ownership gate every /api/feeds/:id route goes through: a feed that does
// not exist and a feed owned by someone else are the same 404.
export async function loadFeedForUser(
  db: Db,
  userEmail: string,
  feedId: number,
): Promise<FeedRow | null> {
  const rows = await db
    .select()
    .from(feeds)
    .where(and(eq(feeds.id, feedId), eq(feeds.userEmail, userEmail)))
    .limit(1);
  return rows[0] ?? null;
}

// Bumps `prefVersion` only on a real preferences change (a no-op resave must
// not force a full re-evaluation on the next run) — same rule as the global
// preferences row.
export async function updateFeed(
  db: Db,
  feed: FeedRow,
  input: { title: string; preferencesText: string },
): Promise<void> {
  const prefsChanged = input.preferencesText !== feed.preferencesText;
  await db
    .update(feeds)
    .set({
      title: input.title,
      preferencesText: input.preferencesText,
      prefVersion: prefsChanged ? feed.prefVersion + 1 : feed.prefVersion,
    })
    .where(eq(feeds.id, feed.id));
}

export async function deleteFeed(db: Db, feedId: number): Promise<void> {
  await db.delete(feedItems).where(eq(feedItems.feedId, feedId));
  await db.delete(feedSources).where(eq(feedSources.feedId, feedId));
  await db.delete(feeds).where(eq(feeds.id, feedId));
}

export async function loadFeedSources(
  db: Db,
  feedId: number,
): Promise<FeedSourceRow[]> {
  return db
    .select()
    .from(feedSources)
    .where(eq(feedSources.feedId, feedId))
    .orderBy(asc(feedSources.createdAt), asc(feedSources.id));
}

export type AddSourceResult =
  | { ok: true; source: FeedSourceRow }
  | {
      ok: false;
      reason: "limit" | "duplicate" | "unreachable";
      message: string;
    };

// Adding a source validates it end-to-end: the URL must fetch and parse as a
// feed right now (its channel title is captured for display).
export async function addFeedSource(
  db: Db,
  rss: RssClient,
  feed: FeedRow,
  url: string,
  now: Date,
): Promise<AddSourceResult> {
  const existing = await loadFeedSources(db, feed.id);
  if (existing.length >= MAX_FEED_SOURCES) {
    return {
      ok: false,
      reason: "limit",
      message: `A feed can have at most ${String(MAX_FEED_SOURCES)} sources`,
    };
  }
  if (existing.some((s) => s.url === url)) {
    return {
      ok: false,
      reason: "duplicate",
      message: "This feed already has that source",
    };
  }
  let parsed;
  try {
    parsed = await rss.fetch(url);
  } catch (error) {
    return {
      ok: false,
      reason: "unreachable",
      message:
        error instanceof Error ? error.message : "Could not fetch that URL",
    };
  }
  const rows = await db
    .insert(feedSources)
    .values({ feedId: feed.id, url, title: parsed.title, createdAt: now })
    .returning();
  const source = rows[0];
  if (source === undefined) {
    throw new Error("feed source insert returned no row");
  }
  return { ok: true, source };
}

/** Idempotent: removing an unknown source is a no-op. */
export async function removeFeedSource(
  db: Db,
  feedId: number,
  sourceId: number,
): Promise<void> {
  await db
    .delete(feedSources)
    .where(and(eq(feedSources.feedId, feedId), eq(feedSources.id, sourceId)));
}

function domainOf(link: string): string {
  try {
    return new URL(link).hostname.replace(/^www\./, "");
  } catch {
    return "unknown";
  }
}

// Which source yielded a link: the first source of the fetch that carried it.
interface SourcedItem extends ParsedFeedItem {
  sourceId: number;
}

interface EvaluatedItem extends SourcedItem {
  relevant: boolean;
  relevanceScore: number;
}

// Fetch every source, dedupe by link, and (re-)judge only what the current
// prefVersion hasn't judged yet — the feeds twin of digest.ts's curateForUser.
// The AI pass runs BEFORE the upsert (new items have no DB id yet, so the
// prompt uses synthetic array-index ids); the single write pass then sets
// current = relevant for exactly the items of this fetch. Items whose batch
// failed to parse stay unwritten and are retried next run.
export async function runFeedFetch(
  db: Db,
  deps: { rss: RssClient; ai: AiFilter },
  feed: FeedRow,
  now: Date,
): Promise<DigestResult> {
  const sources = await loadFeedSources(db, feed.id);
  if (sources.length === 0) {
    return { count: 0 };
  }
  const perSource = await Promise.all(
    sources.map(async (source): Promise<SourcedItem[]> => {
      try {
        const { items } = await deps.rss.fetch(source.url);
        return items.map((item) => ({ ...item, sourceId: source.id }));
      } catch {
        // One broken source must not kill the whole run.
        console.warn(`[feeds] source ${String(source.id)} failed; skipping`);
        return [];
      }
    }),
  );
  // `sources` is ordered by creation, so the first source carrying a link wins
  // both the dedupe and the attribution.
  const byLink = new Map<string, SourcedItem>();
  for (const item of perSource.flat()) {
    if (!byLink.has(item.link)) {
      byLink.set(item.link, item);
    }
  }
  const candidates = [...byLink.values()];

  const trimmedPrefs = feed.preferencesText.trim();
  let evaluated: EvaluatedItem[];
  if (trimmedPrefs === "") {
    // AI-free fallback: everything is "relevant"; the page caps at 20 newest.
    evaluated = candidates.map((c) => ({
      ...c,
      relevant: true,
      relevanceScore: 0,
    }));
  } else {
    const priorRows = await db
      .select()
      .from(feedItems)
      .where(
        and(
          eq(feedItems.feedId, feed.id),
          eq(feedItems.prefVersion, feed.prefVersion),
        ),
      );
    const reusable = new Map(priorRows.map((r) => [r.link, r]));
    const toEvaluate = candidates.filter((c) => !reusable.has(c.link));
    const verdicts = await deps.ai.selectFeedItems(
      trimmedPrefs,
      toEvaluate.map((c, i) => ({
        id: i,
        title: c.title,
        domain: domainOf(c.link),
        summary: c.summary,
      })),
    );
    const fresh = new Map(
      verdicts.flatMap((v) => {
        const candidate = toEvaluate[v.id];
        return candidate === undefined ? [] : [[candidate.link, v] as const];
      }),
    );
    evaluated = candidates.flatMap((c) => {
      const prior = reusable.get(c.link);
      if (prior !== undefined) {
        return [
          {
            ...c,
            relevant: prior.relevant,
            relevanceScore: prior.relevanceScore,
          },
        ];
      }
      const verdict = fresh.get(c.link);
      return verdict === undefined
        ? []
        : [{ ...c, relevant: verdict.relevant, relevanceScore: verdict.score }];
    });
    console.log(
      `[feeds] feed=${String(feed.id)} candidates=${String(candidates.length)} reused=${String(reusable.size)} evaluated=${String(toEvaluate.length)}`,
    );
  }

  await db
    .update(feedItems)
    .set({ current: false })
    .where(eq(feedItems.feedId, feed.id));
  for (const part of chunk(evaluated, ITEM_CHUNK)) {
    await db
      .insert(feedItems)
      .values(
        part.map((e) => ({
          feedId: feed.id,
          sourceId: e.sourceId,
          link: e.link,
          title: e.title,
          description: e.summary ?? null,
          publishedAt: e.publishedAt,
          fetchedAt: now,
          relevant: e.relevant,
          relevanceScore: e.relevanceScore,
          prefVersion: feed.prefVersion,
          current: e.relevant,
        })),
      )
      .onConflictDoUpdate({
        target: [feedItems.feedId, feedItems.link],
        // sentAt is deliberately absent: the send-once stamp survives refetches.
        set: {
          sourceId: sql`excluded.source_id`,
          title: sql`excluded.title`,
          description: sql`excluded.description`,
          publishedAt: sql`excluded.published_at`,
          fetchedAt: sql`excluded.fetched_at`,
          relevant: sql`excluded.relevant`,
          relevanceScore: sql`excluded.relevance_score`,
          prefVersion: sql`excluded.pref_version`,
          current: sql`excluded.current`,
        },
      });
  }
  await db
    .update(feeds)
    .set({ lastFetchedAt: now })
    .where(eq(feeds.id, feed.id));
  return { count: evaluated.filter((e) => e.relevant).length };
}

// SQLite treats NULL as smaller than any value, so `publishedAt DESC` puts
// undated items last on its own; fetchedAt/id break ties deterministically.
const itemOrder = [
  desc(feedItems.publishedAt),
  desc(feedItems.fetchedAt),
  desc(feedItems.id),
];

/** The feed page: newest ≤20 relevant items of the latest fetch. */
export async function loadFeedItems(
  db: Db,
  feedId: number,
): Promise<FeedItemRow[]> {
  return db
    .select()
    .from(feedItems)
    .where(and(eq(feedItems.feedId, feedId), eq(feedItems.current, true)))
    .orderBy(...itemOrder)
    .limit(PAGE_SIZE);
}

/** The feed's archive: every item ever judged relevant, current or not. */
export async function loadFeedArchive(
  db: Db,
  feedId: number,
): Promise<FeedItemRow[]> {
  return db
    .select()
    .from(feedItems)
    .where(and(eq(feedItems.feedId, feedId), eq(feedItems.relevant, true)))
    .orderBy(...itemOrder);
}

// Oldest-first, the mirror image of `itemOrder`: undated items lead (SQLite sorts
// NULL first ascending), then oldest published. The send queue must drain, and a
// newest-first queue starves a backlog bigger than one message forever.
const sendOrder = [
  asc(feedItems.publishedAt),
  asc(feedItems.fetchedAt),
  asc(feedItems.id),
];

// The Telegram selection: every relevant item never delivered before (send-once),
// oldest first. Deliberately NOT gated on `current` — an item judged relevant
// whose article rolled out of the RSS window before a digest ran is still owed to
// the user, and `current` only tracks live-feed membership.
export async function loadUnsentFeedItems(
  db: Db,
  feedId: number,
): Promise<FeedItemRow[]> {
  return db
    .select()
    .from(feedItems)
    .where(
      and(
        eq(feedItems.feedId, feedId),
        eq(feedItems.relevant, true),
        isNull(feedItems.sentAt),
      ),
    )
    .orderBy(...sendOrder);
}

/** One source's items, newest first, for the settings drill-down. */
export async function loadSourceItems(
  db: Db,
  feedId: number,
  sourceId: number,
): Promise<FeedItemRow[]> {
  return db
    .select()
    .from(feedItems)
    .where(and(eq(feedItems.feedId, feedId), eq(feedItems.sourceId, sourceId)))
    .orderBy(...itemOrder)
    .limit(SOURCE_ITEM_LIMIT);
}

export interface SourceCounts {
  fetched: number;
  selected: number;
}

// Per-source fetched/selected counts in ONE aggregate query (no N+1): group by
// source and verdict, then fold. Rows written before source attribution have a
// null `sourceId` and simply belong to no source.
export async function loadSourceCounts(
  db: Db,
  feedId: number,
): Promise<Map<number, SourceCounts>> {
  const rows = await db
    .select({
      sourceId: feedItems.sourceId,
      relevant: feedItems.relevant,
      items: count(),
    })
    .from(feedItems)
    .where(eq(feedItems.feedId, feedId))
    .groupBy(feedItems.sourceId, feedItems.relevant);
  const counts = new Map<number, SourceCounts>();
  for (const row of rows) {
    if (row.sourceId === null) {
      continue;
    }
    const current = counts.get(row.sourceId) ?? { fetched: 0, selected: 0 };
    counts.set(row.sourceId, {
      fetched: current.fetched + row.items,
      selected: current.selected + (row.relevant ? row.items : 0),
    });
  }
  return counts;
}

export async function markFeedItemsSent(
  db: Db,
  ids: number[],
  now: Date,
): Promise<void> {
  if (ids.length === 0) {
    return;
  }
  await db
    .update(feedItems)
    .set({ sentAt: now })
    .where(inArray(feedItems.id, ids));
}
