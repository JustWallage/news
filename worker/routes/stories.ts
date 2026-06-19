import { and, desc, eq } from "drizzle-orm";
import { Hono } from "hono";
import { curations } from "../../db/schema";
import type { AppEnv } from "../env";
import { getDb } from "../lib/db";
import { curatedStories, loadFeed } from "../lib/feed";
import { toStory } from "../lib/serialize";

export const storiesRoutes = new Hono<AppEnv>();

// The signed-in user's current feed: their curated stories joined to the shared
// content cache, best matches first.
storiesRoutes.get("/", async (c) => {
  const db = getDb(c.env);
  return c.json({ stories: await loadFeed(db, c.get("userEmail")) });
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
