import { Hono } from "hono";
import type { AppEnv } from "../env";
import { getDb } from "../lib/db";
import { loadPublicFeed } from "../lib/feed";

export const publicRoutes = new Hono<AppEnv>();

publicRoutes.get("/feed", async (c) =>
  c.json(await loadPublicFeed(getDb(c.env), c.env.OWNER_EMAIL)),
);
