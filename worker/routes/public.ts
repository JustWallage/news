import { Hono } from "hono";
import type { AppEnv } from "../env";
import { getDb } from "../lib/db";
import { loadPublicFeed } from "../lib/feed";

export const publicRoutes = new Hono<AppEnv>();

// The owner's live curated feed for anonymous visitors (the homepage "Show live
// demo" button → /demo). Mounted OUTSIDE /api so it needs no session AND never
// receives the AI deps — it reads stored curations only, so anonymous traffic
// can never trigger a Workers AI run.
publicRoutes.get("/feed", async (c) =>
  c.json(await loadPublicFeed(getDb(c.env), c.env.OWNER_EMAIL)),
);
