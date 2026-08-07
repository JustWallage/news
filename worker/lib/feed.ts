import { and, desc, eq, isNotNull, type SQL } from "drizzle-orm";
import type { DemoFeed, Story } from "../../shared/api";
import { curations, stories } from "../../db/schema";
import type { Db } from "./db";
import { loadPreferences } from "./digest";
import { toPublicStory, toStory } from "./serialize";

// The user's curated stories (feed or archive) joined to the shared content
// cache; the caller narrows the set and adds the ordering.
function curatedStories(db: Db, userEmail: string, only: SQL) {
  return db
    .select({
      id: stories.id,
      title: stories.title,
      url: stories.url,
      by: stories.by,
      score: stories.score,
      comments: stories.comments,
      time: stories.time,
      relevanceScore: curations.relevanceScore,
      reason: curations.reason,
      openedAt: curations.openedAt,
      curatedAt: curations.curatedAt,
    })
    .from(curations)
    .innerJoin(stories, eq(curations.storyId, stories.id))
    .where(and(eq(curations.userEmail, userEmail), only));
}

// Best matches first — the feed's own order, reused as the archive's tie-break
// within one run.
const feedOrder = [desc(curations.relevanceScore), desc(stories.score)];

// The user's current feed as serialized stories, best matches first. Shared by
// the stories route and the Telegram daily digest.
export async function loadFeed(db: Db, userEmail: string): Promise<Story[]> {
  const rows = await curatedStories(
    db,
    userEmail,
    eq(curations.current, true),
  ).orderBy(...feedOrder);
  return rows.map(toStory);
}

// The user's archive: every story ever shown in their feed, the current one
// included, most recently shown first. Keyed on `lastShownAt`, so a story the
// AI has since judged irrelevant stays — and stories the AI never picked
// (curated but never shown) never appear.
export async function loadArchive(db: Db, userEmail: string): Promise<Story[]> {
  const rows = await curatedStories(
    db,
    userEmail,
    isNotNull(curations.lastShownAt),
  ).orderBy(desc(curations.lastShownAt), ...feedOrder);
  return rows.map(toStory);
}

// Reads stored curations + preferences only — never runs the AI digest, so an
// anonymous demo hit can't burn the Neuron budget.
export async function loadPublicFeed(
  db: Db,
  ownerEmail: string,
): Promise<DemoFeed> {
  const rows = await curatedStories(
    db,
    ownerEmail,
    eq(curations.current, true),
  ).orderBy(...feedOrder);
  const { text } = await loadPreferences(db, ownerEmail);
  const lastCuratedAt =
    rows.length === 0
      ? null
      : new Date(
          Math.max(...rows.map((row) => row.curatedAt.getTime())),
        ).toISOString();
  return { stories: rows.map(toPublicStory), preferences: text, lastCuratedAt };
}
