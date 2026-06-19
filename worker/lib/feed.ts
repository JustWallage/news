import { and, desc, eq } from "drizzle-orm";
import type { Story } from "../../shared/api";
import { curations, stories } from "../../db/schema";
import type { Db } from "./db";
import { toStory } from "./serialize";

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
