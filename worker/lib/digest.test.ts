import { env } from "cloudflare:workers";
import { and, eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { curations, stories } from "../../db/schema";
import { getDb } from "./db";
import { runDigest, type AiFilter } from "./digest";
import type { HnClient, HnItem } from "./hn";

const ITEMS: HnItem[] = [
  {
    id: 1,
    type: "story",
    title: "Rust rocks",
    url: "https://e.com/r",
    by: "alice",
    score: 100,
    descendants: 10,
    time: 1700000000,
  },
  {
    id: 2,
    type: "story",
    title: "Bitcoin moons",
    url: "https://e.com/b",
    by: "bob",
    score: 50,
    descendants: 5,
    time: 1700000100,
  },
];

// HN client that counts item() downloads so we can assert the incremental cache.
function countingHn(): { hn: HnClient; downloads: () => number } {
  let downloads = 0;
  return {
    downloads: () => downloads,
    hn: {
      topStoryIds: () => Promise.resolve(ITEMS.map((i) => i.id)),
      item: (id) => {
        downloads += 1;
        return Promise.resolve(ITEMS.find((i) => i.id === id) ?? null);
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

// The pool gives one D1 per test FILE, so reset the shared tables per test.
beforeEach(async () => {
  const db = getDb(env);
  await db.delete(curations);
  await db.delete(stories);
});

describe("runDigest", () => {
  it("curates only matching stories for the user and caches all candidates", async () => {
    const db = getDb(env);
    const result = await runDigest(
      db,
      { hn: countingHn().hn, ai: keywordFilter("rust") },
      "rust",
      USER,
      new Date(),
    );
    expect(result.count).toBe(1);

    const feed = await db
      .select()
      .from(curations)
      .where(and(eq(curations.userEmail, USER), eq(curations.current, true)));
    expect(feed.map((c) => c.storyId)).toEqual([1]);
    expect((await db.select().from(stories)).length).toBe(2);
  });

  it("does not re-download cached stories within a minute", async () => {
    const db = getDb(env);
    const now = new Date("2026-06-17T06:20:00Z");
    const first = countingHn();
    await runDigest(
      db,
      { hn: first.hn, ai: keywordFilter("rust") },
      "rust",
      USER,
      now,
    );
    expect(first.downloads()).toBe(2);

    const second = countingHn();
    await runDigest(
      db,
      { hn: second.hn, ai: keywordFilter("rust") },
      "rust",
      USER,
      new Date(now.getTime() + 30_000),
    );
    expect(second.downloads()).toBe(0);
  });

  it("re-downloads cached stories older than a minute", async () => {
    const db = getDb(env);
    const now = new Date("2026-06-17T06:20:00Z");
    await runDigest(
      db,
      { hn: countingHn().hn, ai: keywordFilter("rust") },
      "rust",
      USER,
      now,
    );

    const stale = countingHn();
    await runDigest(
      db,
      { hn: stale.hn, ai: keywordFilter("rust") },
      "rust",
      USER,
      new Date(now.getTime() + 61_000),
    );
    expect(stale.downloads()).toBe(2);
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
});
