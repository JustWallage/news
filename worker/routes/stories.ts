import { and, desc, eq } from "drizzle-orm";
import { Hono } from "hono";
import { curations, stories } from "../../db/schema";
import type { AppEnv } from "../env";
import { getDb } from "../lib/db";
import { toStory } from "../lib/serialize";

export const storiesRoutes = new Hono<AppEnv>();

// The user's curated stories (feed or archive) joined to the shared content
// cache; the caller adds the ordering.
function curatedStories(
  db: ReturnType<typeof getDb>,
  userEmail: string,
  current: boolean,
) {
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

// The signed-in user's current feed: best matches first.
storiesRoutes.get("/", async (c) => {
  const rows = await curatedStories(
    getDb(c.env),
    c.get("userEmail"),
    true,
  ).orderBy(desc(curations.relevanceScore), desc(stories.score));
  return c.json({ stories: rows.map(toStory) });
});

// The user's archive: curations the daily digest displaced (current = false).
// These accumulate forever — never re-scored or removed — newest first.
storiesRoutes.get("/archive", async (c) => {
  const rows = await curatedStories(
    getDb(c.env),
    c.get("userEmail"),
    false,
  ).orderBy(desc(curations.curatedAt));
  return c.json({ stories: rows.map(toStory) });
});

// Record the first time the user opens a story; idempotent (later opens no-op).
storiesRoutes.post("/:id/open", async (c) => {
  const storyId = Number(c.req.param("id"));
  if (!Number.isInteger(storyId)) {
    return c.json({ error: "Invalid id" }, 400);
  }
  const db = getDb(c.env);
  const userEmail = c.get("userEmail");
  const rows = await db
    .select()
    .from(curations)
    .where(
      and(eq(curations.userEmail, userEmail), eq(curations.storyId, storyId)),
    )
    .limit(1);
  const row = rows[0] ?? null;
  if (row === null) {
    return c.json({ error: "Story not found" }, 404);
  }
  if (row.openedAt === null) {
    await db
      .update(curations)
      .set({ openedAt: new Date() })
      .where(
        and(eq(curations.userEmail, userEmail), eq(curations.storyId, storyId)),
      );
  }
  return c.json({ ok: true });
});
