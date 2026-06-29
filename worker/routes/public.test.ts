import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { curations, stories } from "../../db/schema";
import { getDb } from "../lib/db";
import { app } from "../index";

// The test pool runs in the e2e env, so OWNER_EMAIL is the seeded demo account.
const OWNER = env.OWNER_EMAIL;
const OTHER = "someone-else@news.test";
const TIME = new Date("2026-06-20T10:00:00.000Z");
const T1 = new Date("2026-06-28T08:00:00.000Z");
const T2 = new Date("2026-06-29T08:00:00.000Z");

beforeEach(async () => {
  const db = getDb(env);
  await db.delete(curations);
  await db.delete(stories);
});

async function seedStories(): Promise<void> {
  const db = getDb(env);
  await db.insert(stories).values([
    { id: 1, title: "Rust story", url: "https://example.com/rust", by: "alice", score: 412, comments: 88, time: TIME, fetchedAt: TIME }, // prettier-ignore
    { id: 2, title: "Go story", url: "https://example.com/go", by: "bob", score: 120, comments: 12, time: TIME, fetchedAt: TIME }, // prettier-ignore
    { id: 3, title: "Archived story", url: null, by: "carol", score: 9, comments: 1, time: TIME, fetchedAt: TIME }, // prettier-ignore
  ]);
}

describe("public demo feed", () => {
  it("serves the owner's current feed, best matches first, with only public fields", async () => {
    const db = getDb(env);
    await seedStories();
    await db.insert(curations).values([
      { userEmail: OWNER, storyId: 1, relevanceScore: 90, reason: "match", curatedAt: T1, current: true, openedAt: TIME }, // prettier-ignore
      { userEmail: OWNER, storyId: 2, relevanceScore: 50, reason: "match", curatedAt: T2, current: true, openedAt: null }, // prettier-ignore
      { userEmail: OWNER, storyId: 3, relevanceScore: 70, reason: "old", curatedAt: T1, current: false, openedAt: null }, // prettier-ignore
      { userEmail: OTHER, storyId: 1, relevanceScore: 99, reason: "other", curatedAt: T2, current: true, openedAt: null }, // prettier-ignore
    ]);

    // No auth headers: the endpoint is outside /api, so it serves the owner feed
    // regardless of the caller.
    const res = await app.request("/public/feed", {}, env);
    expect(res.status).toBe(200);

    const body = await res.json<{
      stories: Record<string, unknown>[];
      lastCuratedAt: string | null;
    }>();

    // Only the owner's current curations, ordered by relevance desc.
    expect(body.stories.map((s) => s.id)).toEqual([1, 2]);
    expect(body.lastCuratedAt).toBe(T2.toISOString());

    // Exactly the public fields — no per-user curation fields leak.
    expect(Object.keys(body.stories[0] ?? {}).sort()).toEqual(
      ["by", "comments", "id", "score", "time", "title", "url"].sort(),
    );
    for (const story of body.stories) {
      expect(story).not.toHaveProperty("openedAt");
      expect(story).not.toHaveProperty("relevanceScore");
      expect(story).not.toHaveProperty("reason");
    }
  });

  it("returns an empty feed when the owner has no current curations", async () => {
    const db = getDb(env);
    await seedStories();
    // A current curation for a DIFFERENT account must not surface.
    await db.insert(curations).values([
      { userEmail: OTHER, storyId: 1, relevanceScore: 99, reason: "other", curatedAt: T2, current: true, openedAt: null }, // prettier-ignore
    ]);

    const body = await (
      await app.request("/public/feed", {}, env)
    ).json<{ stories: unknown[]; lastCuratedAt: string | null }>();
    expect(body.stories).toEqual([]);
    expect(body.lastCuratedAt).toBeNull();
  });

  it("keeps the no-store cache policy", async () => {
    const res = await app.request("/public/feed", {}, env);
    expect(res.headers.get("Cache-Control")).toBe("private, no-store");
  });
});
