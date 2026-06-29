import { and, desc, eq } from "drizzle-orm";
import type { DemoFeed, Story } from "../../shared/api";
import { curations, stories } from "../../db/schema";
import type { Db } from "./db";
import { toPublicStory, toStory } from "./serialize";

// The user's curated stories (feed or archive) joined to the shared content
// cache; the caller adds the ordering.
export function curatedStories(db: Db, userEmail: string, current: boolean) {
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
    .where(
      and(eq(curations.userEmail, userEmail), eq(curations.current, current)),
    );
}

// The user's current feed as serialized stories, best matches first. Shared by
// the stories route and the Telegram daily digest.
export async function loadFeed(db: Db, userEmail: string): Promise<Story[]> {
  const rows = await curatedStories(db, userEmail, true).orderBy(
    desc(curations.relevanceScore),
    desc(stories.score),
  );
  return rows.map(toStory);
}

// The owner's current feed for the anonymous public demo: the SAME query +
// ordering as loadFeed, mapped to the public-safe projection, plus the latest
// curatedAt for the "last refreshed X" line (null when the owner has none).
// Reads stored curations only — never runs a digest / Workers AI.
export async function loadPublicFeed(
  db: Db,
  ownerEmail: string,
): Promise<DemoFeed> {
  const rows = await curatedStories(db, ownerEmail, true).orderBy(
    desc(curations.relevanceScore),
    desc(stories.score),
  );
  const lastCuratedAt =
    rows.length === 0
      ? null
      : new Date(
          Math.max(...rows.map((row) => row.curatedAt.getTime())),
        ).toISOString();
  return { stories: rows.map(toPublicStory), lastCuratedAt };
}
