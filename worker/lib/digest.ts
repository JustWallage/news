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

// D1 caps a query at 100 bound parameters, so multi-row inserts are chunked to
// stay under it: stories have 8 columns, curations 7 → 10 rows/insert is safe.
const STORY_CHUNK = 10;
const CURATION_CHUNK = 10;

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    out.push(items.slice(i, i + size));
  }
  return out;
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
  const trimmedPrefs = prefsText.trim();
  console.log(
    `[digest] user=${userEmail} candidates=${candidates.length} prefs=${
      trimmedPrefs === "" ? "(empty)" : `${trimmedPrefs.length} chars`
    }`,
  );

  // Refresh the global content cache (chunked multi-row upserts; D1 100-param cap).
  for (const part of chunk(candidates, STORY_CHUNK)) {
    await db
      .insert(stories)
      .values(
        part.map((s) => ({
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

  let selected: { storyId: number; relevanceScore: number; reason: string }[];
  if (trimmedPrefs === "") {
    selected = [...candidates]
      .sort((a, b) => b.score - a.score)
      .slice(0, UNFILTERED_FALLBACK)
      .map((c) => ({ storyId: c.id, relevanceScore: 0, reason: "" }));
  } else {
    const verdicts = await deps.ai.select(trimmedPrefs, candidates);
    const known = new Set(candidates.map((c) => c.id));
    selected = verdicts
      .filter((v) => v.relevant && known.has(v.id))
      .map((v) => ({
        storyId: v.id,
        relevanceScore: v.score,
        reason: v.reason,
      }));
    console.log(
      `[digest] ai verdicts=${verdicts.length} relevant=${selected.length}`,
    );
  }
  console.log(`[digest] selected=${selected.length} for user=${userEmail}`);

  // Replace this user's current feed: drop everyone out, then upsert the freshly
  // selected stories as current (keeping openedAt on rows that survive). Both are
  // single statements, so the whole run stays at a handful of subrequests.
  await db
    .update(curations)
    .set({ current: false })
    .where(eq(curations.userEmail, userEmail));
  for (const part of chunk(selected, CURATION_CHUNK)) {
    await db
      .insert(curations)
      .values(
        part.map((s) => ({
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
