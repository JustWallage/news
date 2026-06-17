import { eq, inArray } from "drizzle-orm";
import { curations, preferences, stories } from "../../db/schema";
import type { Db } from "./db";
import type { HnClient, HnItem } from "./hn";

// Plain shape the AI filter scores.
export interface StoryInput {
  id: number;
  title: string;
  url: string | null;
  by: string;
  score: number;
  comments: number;
  /** HN submission time in epoch seconds. */
  time: number;
}

export interface Verdict {
  id: number;
  relevant: boolean;
  score: number;
  reason: string;
}

/** The external dependency seam for relevance filtering (Workers AI in prod). */
export interface AiFilter {
  select(prefs: string, stories: StoryInput[]): Promise<Verdict[]>;
}

const TOP_N = 100;
const ITEM_CONCURRENCY = 8;
const UNFILTERED_FALLBACK = 30;
// A cached story is re-downloaded once its content is older than this.
const STALE_MS = 60_000;

function toStoryInput(item: HnItem): StoryInput | null {
  if (item.type !== "story" || item.dead === true || item.deleted === true) {
    return null;
  }
  if (item.title === undefined || item.by === undefined) {
    return null;
  }
  return {
    id: item.id,
    title: item.title,
    url: item.url ?? null,
    by: item.by,
    score: item.score ?? 0,
    comments: item.descendants ?? 0,
    time: item.time ?? 0,
  };
}

async function mapLimit<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let cursor = 0;
  async function worker(): Promise<void> {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      const item = items[index];
      if (item !== undefined) {
        results[index] = await fn(item);
      }
    }
  }
  const size = Math.min(limit, items.length);
  await Promise.all(Array.from({ length: size }, () => worker()));
  return results;
}

export async function loadPreferences(
  db: Db,
  userEmail: string,
): Promise<string> {
  const rows = await db
    .select()
    .from(preferences)
    .where(eq(preferences.userEmail, userEmail))
    .limit(1);
  return rows[0]?.text ?? "";
}

// Refresh the global story cache for the top ids: download only the items that
// are missing or older than STALE_MS, and upsert them. Returns the cached rows
// turned into AI inputs.
async function refreshCache(
  db: Db,
  hn: HnClient,
  ids: number[],
  now: Date,
): Promise<StoryInput[]> {
  if (ids.length === 0) {
    return [];
  }
  const existing = await db
    .select({ id: stories.id, fetchedAt: stories.fetchedAt })
    .from(stories)
    .where(inArray(stories.id, ids));
  const seenAt = new Map(existing.map((row) => [row.id, row.fetchedAt]));
  const staleBefore = new Date(now.getTime() - STALE_MS);
  const toFetch = ids.filter((id) => {
    const fetchedAt = seenAt.get(id);
    return fetchedAt === undefined || fetchedAt < staleBefore;
  });

  const fetched = await mapLimit(toFetch, ITEM_CONCURRENCY, (id) =>
    hn.item(id),
  );
  for (const item of fetched) {
    if (item === null) {
      continue;
    }
    const input = toStoryInput(item);
    if (input === null) {
      continue;
    }
    await db
      .insert(stories)
      .values({
        id: input.id,
        title: input.title,
        url: input.url,
        by: input.by,
        score: input.score,
        comments: input.comments,
        time: new Date(input.time * 1000),
        fetchedAt: now,
      })
      .onConflictDoUpdate({
        target: stories.id,
        set: {
          title: input.title,
          url: input.url,
          score: input.score,
          comments: input.comments,
          fetchedAt: now,
        },
      });
  }

  const rows = await db.select().from(stories).where(inArray(stories.id, ids));
  return rows.map((row) => ({
    id: row.id,
    title: row.title,
    url: row.url,
    by: row.by,
    score: row.score,
    comments: row.comments,
    time: Math.floor(row.time.getTime() / 1000),
  }));
}

export interface DigestResult {
  count: number;
}

export async function runDigest(
  db: Db,
  deps: { hn: HnClient; ai: AiFilter },
  prefsText: string,
  userEmail: string,
  now: Date,
): Promise<DigestResult> {
  const ids = (await deps.hn.topStoryIds()).slice(0, TOP_N);
  const candidates = await refreshCache(db, deps.hn, ids, now);

  const trimmed = prefsText.trim();
  let selected: { storyId: number; relevanceScore: number; reason: string }[];
  if (trimmed === "") {
    selected = [...candidates]
      .sort((a, b) => b.score - a.score)
      .slice(0, UNFILTERED_FALLBACK)
      .map((c) => ({ storyId: c.id, relevanceScore: 0, reason: "" }));
  } else {
    const verdicts = await deps.ai.select(trimmed, candidates);
    const known = new Set(candidates.map((c) => c.id));
    selected = verdicts
      .filter((v) => v.relevant && known.has(v.id))
      .map((v) => ({
        storyId: v.id,
        relevanceScore: v.score,
        reason: v.reason,
      }));
  }

  // Replace this user's current feed: drop everyone out, then re-mark the
  // freshly selected stories (keeping openedAt on rows that survive).
  await db
    .update(curations)
    .set({ current: false })
    .where(eq(curations.userEmail, userEmail));
  for (const { storyId, relevanceScore, reason } of selected) {
    await db
      .insert(curations)
      .values({
        userEmail,
        storyId,
        relevanceScore,
        reason,
        curatedAt: now,
        current: true,
        openedAt: null,
      })
      .onConflictDoUpdate({
        target: [curations.userEmail, curations.storyId],
        set: { relevanceScore, reason, curatedAt: now, current: true },
      });
  }
  return { count: selected.length };
}
