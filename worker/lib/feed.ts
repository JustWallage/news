import { and, desc, eq } from "drizzle-orm";
import type { Story } from "../../shared/api";
import { curations, stories } from "../../db/schema";
import type { Db } from "./db";
import { toStory } from "./serialize";

// A user's current feed: their curated stories joined to the shared content
// cache, best matches first. Shared by the stories route and the Telegram
// daily digest.
export async function loadFeed(db: Db, userEmail: string): Promise<Story[]> {
  const rows = await db
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
    .where(and(eq(curations.userEmail, userEmail), eq(curations.current, true)))
    .orderBy(desc(curations.relevanceScore), desc(stories.score));
  return rows.map(toStory);
}
