import { env } from "cloudflare:workers";
import { and, eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { curations, stories } from "../../db/schema";
import { getDb } from "./db";
import { runDigest, type AiFilter, type StoryInput } from "./digest";
import type { HnClient } from "./hn";

const FRONT: StoryInput[] = [
  {
    id: 1,
    title: "Rust rocks",
    url: "https://e.com/r",
    by: "alice",
    score: 100,
    comments: 10,
    time: 1700000000,
  },
  {
    id: 2,
    title: "Bitcoin moons",
    url: "https://e.com/b",
    by: "bob",
    score: 50,
    comments: 5,
    time: 1700000100,
  },
];

// HN client that counts front-page fetches (asserts the single-request design).
function countingHn(): { hn: HnClient; fetches: () => number } {
  let fetches = 0;
  return {
    fetches: () => fetches,
    hn: {
      frontPage: () => {
        fetches += 1;
        return Promise.resolve(FRONT);
      },
    },
  };
}

const keywordFilter = (needle: string): AiFilter => ({
  select: (_prefs, list) =>
    Promise.resolve(
      list.map((s) => ({
        id: s.id,
        relevant: s.title.toLowerCase().includes(needle),
        score: 80,
        reason: "x",
      })),
    ),
});

const USER = "just@wallage.nl";

beforeEach(async () => {
  const db = getDb(env);
  await db.delete(curations);
  await db.delete(stories);
});

describe("runDigest", () => {
  it("fetches the front page once and caches every candidate", async () => {
    const db = getDb(env);
    const hn = countingHn();
    const result = await runDigest(
      db,
      { hn: hn.hn, ai: keywordFilter("rust") },
      "rust",
      USER,
      new Date(),
    );
    expect(result.count).toBe(1);
    expect(hn.fetches()).toBe(1);

    const feed = await db
      .select()
      .from(curations)
      .where(and(eq(curations.userEmail, USER), eq(curations.current, true)));
    expect(feed.map((c) => c.storyId)).toEqual([1]);
    expect((await db.select().from(stories)).length).toBe(2);
  });

  it("refreshes cached story content on a later run", async () => {
    const db = getDb(env);
    await runDigest(
      db,
      { hn: countingHn().hn, ai: keywordFilter("rust") },
      "rust",
      USER,
      new Date(),
    );
    const bumped: HnClient = {
      frontPage: () =>
        Promise.resolve(
          FRONT.map((s) => (s.id === 1 ? { ...s, score: 999 } : s)),
        ),
    };
    await runDigest(
      db,
      { hn: bumped, ai: keywordFilter("rust") },
      "rust",
      USER,
      new Date(),
    );
    const row = await db.select().from(stories).where(eq(stories.id, 1));
    expect(row[0]?.score).toBe(999);
  });

  it("replaces the current feed while preserving openedAt and the archive", async () => {
    const db = getDb(env);
    const t0 = new Date("2026-06-17T06:20:00Z");
    await runDigest(
      db,
      { hn: countingHn().hn, ai: keywordFilter("rust") },
      "rust",
      USER,
      t0,
    );
    await db
      .update(curations)
      .set({ openedAt: new Date() })
      .where(and(eq(curations.userEmail, USER), eq(curations.storyId, 1)));

    await runDigest(
      db,
      { hn: countingHn().hn, ai: keywordFilter("bitcoin") },
      "bitcoin",
      USER,
      new Date(t0.getTime() + 2 * 86_400_000),
    );

    const current = await db
      .select()
      .from(curations)
      .where(and(eq(curations.userEmail, USER), eq(curations.current, true)));
    expect(current.map((c) => c.storyId)).toEqual([2]);

    const archived = await db
      .select()
      .from(curations)
      .where(and(eq(curations.userEmail, USER), eq(curations.storyId, 1)));
    expect(archived[0]?.current).toBe(false);
    expect(archived[0]?.openedAt).not.toBeNull();
  });

  it("isolates feeds per user", async () => {
    const db = getDb(env);
    await runDigest(
      db,
      { hn: countingHn().hn, ai: keywordFilter("rust") },
      "rust",
      "a@x.test",
      new Date(),
    );
    await runDigest(
      db,
      { hn: countingHn().hn, ai: keywordFilter("bitcoin") },
      "bitcoin",
      "b@x.test",
      new Date(),
    );

    const a = await db
      .select()
      .from(curations)
      .where(
        and(eq(curations.userEmail, "a@x.test"), eq(curations.current, true)),
      );
    const b = await db
      .select()
      .from(curations)
      .where(
        and(eq(curations.userEmail, "b@x.test"), eq(curations.current, true)),
      );
    expect(a.map((c) => c.storyId)).toEqual([1]);
    expect(b.map((c) => c.storyId)).toEqual([2]);
  });

  it("falls back to top stories by score when preferences are empty", async () => {
    const db = getDb(env);
    const result = await runDigest(
      db,
      {
        hn: countingHn().hn,
        ai: { select: () => Promise.reject(new Error("AI must not run")) },
      },
      "   ",
      USER,
      new Date(),
    );
    expect(result.count).toBe(2);
  });

  it("chunks inserts across many stories (D1 100-param cap)", async () => {
    const db = getDb(env);
    const many: StoryInput[] = Array.from({ length: 25 }, (_unused, i) => ({
      id: 100 + i,
      title: `Story ${i}`,
      url: `https://e.com/${i}`,
      by: "author",
      score: i,
      comments: 0,
      time: 1700000000,
    }));
    const result = await runDigest(
      db,
      {
        hn: { frontPage: () => Promise.resolve(many) },
        ai: keywordFilter("story"),
      },
      "story",
      USER,
      new Date(),
    );
    expect(result.count).toBe(25);
    expect((await db.select().from(stories)).length).toBe(25);
    const feed = await db
      .select()
      .from(curations)
      .where(and(eq(curations.userEmail, USER), eq(curations.current, true)));
    expect(feed.length).toBe(25);
  });
});
