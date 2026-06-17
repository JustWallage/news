import { eq, sql } from "drizzle-orm";
import { curations, preferences, stories } from "../../db/schema";
import type { Db } from "./db";
import type { HnClient } from "./hn";

// Plain shape of a story — returned by the HN client and scored by the AI filter.
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

const UNFILTERED_FALLBACK = 30;

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
  // One request returns the whole front page with content.
  const candidates = await deps.hn.frontPage();

  // Refresh the global content cache in a single multi-row upsert (1 subrequest).
  if (candidates.length > 0) {
    await db
      .insert(stories)
      .values(
        candidates.map((s) => ({
          id: s.id,
          title: s.title,
          url: s.url,
          by: s.by,
          score: s.score,
          comments: s.comments,
          time: new Date(s.time * 1000),
          fetchedAt: now,
        })),
      )
      .onConflictDoUpdate({
        target: stories.id,
        set: {
          title: sql`excluded.title`,
          url: sql`excluded.url`,
          score: sql`excluded.score`,
          comments: sql`excluded.comments`,
          fetchedAt: sql`excluded.fetched_at`,
        },
      });
  }

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

  // Replace this user's current feed: drop everyone out, then upsert the freshly
  // selected stories as current (keeping openedAt on rows that survive). Both are
  // single statements, so the whole run stays at a handful of subrequests.
  await db
    .update(curations)
    .set({ current: false })
    .where(eq(curations.userEmail, userEmail));
  if (selected.length > 0) {
    await db
      .insert(curations)
      .values(
        selected.map((s) => ({
          userEmail,
          storyId: s.storyId,
          relevanceScore: s.relevanceScore,
          reason: s.reason,
          curatedAt: now,
          current: true,
          openedAt: null,
        })),
      )
      .onConflictDoUpdate({
        target: [curations.userEmail, curations.storyId],
        set: {
          relevanceScore: sql`excluded.relevance_score`,
          reason: sql`excluded.reason`,
          curatedAt: sql`excluded.curated_at`,
          current: sql`excluded.current`,
        },
      });
  }
  return { count: selected.length };
}
