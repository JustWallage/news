import { and, desc, eq, sql } from "drizzle-orm";
import {
  curations,
  preferences,
  stories,
  type StoryRow,
} from "../../db/schema";
import { sha256Hex } from "./crypto";
import type { Db } from "./db";
import type { HnClient } from "./hn";

// A short, non-reversible tag for logs — correlatable per user across lines
// without writing the email (PII) into observability output.
async function userTag(userEmail: string): Promise<string> {
  return `user#${(await sha256Hex(userEmail)).slice(0, 8)}`;
}

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
}

/** The external dependency seam for relevance filtering (Workers AI in prod). */
export interface AiFilter {
  select(prefs: string, stories: StoryInput[]): Promise<Verdict[]>;
}

const UNFILTERED_FALLBACK = 30;

// D1 caps a query at 100 bound parameters, so multi-row inserts are chunked to
// stay under it: stories have 8 columns, curations 9 → 10 rows/insert is safe.
const STORY_CHUNK = 10;
const CURATION_CHUNK = 10;

// Rate-limit the upstream HN fetch: within this window of the last fetch, reuse
// the cached front-page snapshot instead of hitting HN again.
const RATE_LIMIT_MS = 5 * 60 * 1000;

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    out.push(items.slice(i, i + size));
  }
  return out;
}

function toStoryInput(row: StoryRow): StoryInput {
  return {
    id: row.id,
    title: row.title,
    url: row.url,
    by: row.by,
    score: row.score,
    comments: row.comments,
    time: Math.floor(row.time.getTime() / 1000),
  };
}

export interface LoadedPreferences {
  text: string;
  version: number;
}

export async function loadPreferences(
  db: Db,
  userEmail: string,
): Promise<LoadedPreferences> {
  const rows = await db
    .select()
    .from(preferences)
    .where(eq(preferences.userEmail, userEmail))
    .limit(1);
  const row = rows[0] ?? null;
  return { text: row?.text ?? "", version: row?.version ?? 0 };
}

// Upsert the preferences text, bumping `version` only on a real change (a no-op
// resave must not force a needless full re-evaluation on the next digest).
// Shared by the PUT route and the Telegram /set-preferences command.
export async function savePreferences(
  db: Db,
  userEmail: string,
  text: string,
): Promise<void> {
  const rows = await db
    .select()
    .from(preferences)
    .where(eq(preferences.userEmail, userEmail))
    .limit(1);
  const existing = rows[0] ?? null;
  if (existing !== null && existing.text === text) {
    return;
  }
  if (existing === null) {
    await db
      .insert(preferences)
      .values({ userEmail, text, updatedAt: new Date() });
  } else {
    await db
      .update(preferences)
      .set({ text, version: existing.version + 1, updatedAt: new Date() })
      .where(eq(preferences.userEmail, userEmail));
  }
}

export interface DigestResult {
  count: number;
}

interface CandidateVerdict {
  storyId: number;
  relevant: boolean;
  relevanceScore: number;
  reason: string;
  curatedAt: Date;
}

// Resolve the front-page candidates ONCE: reuse the cached snapshot if the last
// HN fetch is within the rate-limit window, otherwise fetch the whole front page
// in one request and refresh the global content cache. The cron calls this a
// single time per tick and shares the result across every due user.
export async function fetchFrontPage(
  db: Db,
  hn: HnClient,
  now: Date,
): Promise<StoryInput[]> {
  // The globally last HN fetch is the most recent stories.fetchedAt; every row
  // from one fetch shares that timestamp, so the latest snapshot is exactly the
  // rows equal to it.
  const [latest] = await db
    .select({ fetchedAt: stories.fetchedAt })
    .from(stories)
    .orderBy(desc(stories.fetchedAt))
    .limit(1);
  const lastFetch = latest?.fetchedAt ?? null;

  if (
    lastFetch !== null &&
    now.getTime() - lastFetch.getTime() < RATE_LIMIT_MS
  ) {
    // Within the window: reuse the cached snapshot, no HN fetch, no upsert.
    const cached = await db
      .select()
      .from(stories)
      .where(eq(stories.fetchedAt, lastFetch));
    const candidates = cached.map(toStoryInput);
    console.log(
      `[digest] rate-limited: reusing ${candidates.length} cached stories from ${lastFetch.toISOString()}`,
    );
    return candidates;
  }

  // One request returns the whole front page with content.
  const candidates = await hn.frontPage();
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
  return candidates;
}

// Evaluate the given front-page candidates for one user and recompute their
// feed. Pure per-user work: safe to run concurrently for many users sharing the
// same candidates snapshot.
export async function curateForUser(
  db: Db,
  ai: AiFilter,
  candidates: StoryInput[],
  prefsText: string,
  prefVersion: number,
  userEmail: string,
  now: Date,
): Promise<DigestResult> {
  const trimmedPrefs = prefsText.trim();
  const tag = await userTag(userEmail);

  console.log(
    `[digest] ${tag} candidates=${candidates.length} prefs=${
      trimmedPrefs === "" ? "(empty)" : `${trimmedPrefs.length} chars`
    }`,
  );

  let evaluated: CandidateVerdict[];
  if (trimmedPrefs === "") {
    // AI-free fallback: always recompute the top stories by score, no version-skip.
    evaluated = [...candidates]
      .sort((a, b) => b.score - a.score)
      .slice(0, UNFILTERED_FALLBACK)
      .map((c) => ({
        storyId: c.id,
        relevant: true,
        relevanceScore: 0,
        reason: "",
        curatedAt: now,
      }));
  } else {
    // Reuse verdicts already produced against the CURRENT preference version; only
    // (re-)evaluate front-page candidates judged at an older version (or never).
    // Filtering by version (not the candidate ids) keeps this to two bound
    // parameters — an `inArray` of ~100 ids would breach the D1 100-param cap.
    const priorRows = await db
      .select()
      .from(curations)
      .where(
        and(
          eq(curations.userEmail, userEmail),
          eq(curations.prefVersion, prefVersion),
        ),
      );
    const reusable = new Map(priorRows.map((r) => [r.storyId, r]));
    const toEvaluate = candidates.filter((c) => !reusable.has(c.id));
    const verdicts = await ai.select(trimmedPrefs, toEvaluate);
    const fresh = new Map(
      verdicts
        .filter((v) => toEvaluate.some((c) => c.id === v.id))
        .map((v) => [v.id, v]),
    );
    evaluated = candidates.flatMap((c) => {
      const prior = reusable.get(c.id);
      if (prior !== undefined) {
        return [
          {
            storyId: c.id,
            relevant: prior.relevant,
            relevanceScore: prior.relevanceScore,
            reason: prior.reason,
            curatedAt: prior.curatedAt,
          },
        ];
      }
      const verdict = fresh.get(c.id);
      // A candidate the AI returned no verdict for stays unwritten so it is
      // retried on the next refresh.
      return verdict === undefined
        ? []
        : [
            {
              storyId: c.id,
              relevant: verdict.relevant,
              relevanceScore: verdict.score,
              reason: "",
              curatedAt: now,
            },
          ];
    });
    console.log(
      `[digest] candidates=${candidates.length} reused=${reusable.size} evaluated=${toEvaluate.length}`,
    );
  }
  const relevantCount = evaluated.filter((e) => e.relevant).length;
  console.log(`[digest] relevant=${relevantCount} for ${tag}`);

  // Recompute this user's feed: drop everyone out, then upsert every evaluated
  // candidate, marking current = relevant. Stories not on the current front page
  // keep their row but leave the feed. openedAt survives (not in the update set).
  await db
    .update(curations)
    .set({ current: false })
    .where(eq(curations.userEmail, userEmail));
  for (const part of chunk(evaluated, CURATION_CHUNK)) {
    await db
      .insert(curations)
      .values(
        part.map((e) => ({
          userEmail,
          storyId: e.storyId,
          relevanceScore: e.relevanceScore,
          reason: e.reason,
          relevant: e.relevant,
          prefVersion,
          curatedAt: e.curatedAt,
          current: e.relevant,
          openedAt: null,
        })),
      )
      .onConflictDoUpdate({
        target: [curations.userEmail, curations.storyId],
        set: {
          relevanceScore: sql`excluded.relevance_score`,
          reason: sql`excluded.reason`,
          relevant: sql`excluded.relevant`,
          prefVersion: sql`excluded.pref_version`,
          curatedAt: sql`excluded.curated_at`,
          current: sql`excluded.current`,
        },
      });
  }
  return { count: relevantCount };
}

// Single-user digest: fetch the front page, then curate it for the user. Used by
// the homepage Refresh route and the Telegram /fetch command.
export async function runDigest(
  db: Db,
  deps: { hn: HnClient; ai: AiFilter },
  prefsText: string,
  prefVersion: number,
  userEmail: string,
  now: Date,
): Promise<DigestResult> {
  const candidates = await fetchFrontPage(db, deps.hn, now);
  return curateForUser(
    db,
    deps.ai,
    candidates,
    prefsText,
    prefVersion,
    userEmail,
    now,
  );
}
