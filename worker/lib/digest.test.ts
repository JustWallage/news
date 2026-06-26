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
      })),
    ),
});

// Records how many stories it was asked to evaluate on each run.
function countingFilter(needle: string): {
  ai: AiFilter;
  seen: number[];
} {
  const inner = keywordFilter(needle);
  const seen: number[] = [];
  return {
    seen,
    ai: {
      select: (prefs, list) => {
        seen.push(list.length);
        return inner.select(prefs, list);
      },
    },
  };
}

const USER = "user@example.test";

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
      1,
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
    const t0 = new Date("2026-06-17T06:20:00Z");
    await runDigest(
      db,
      { hn: countingHn().hn, ai: keywordFilter("rust") },
      "rust",
      1,
      USER,
      t0,
    );
    const bumped: HnClient = {
      frontPage: () =>
        Promise.resolve(
          FRONT.map((s) => (s.id === 1 ? { ...s, score: 999 } : s)),
        ),
    };
    // Past the rate-limit window, so HN is actually re-fetched.
    await runDigest(
      db,
      { hn: bumped, ai: keywordFilter("rust") },
      "rust",
      1,
      USER,
      new Date(t0.getTime() + 6 * 60_000),
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
      1,
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
      2,
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
      1,
      "a@x.test",
      new Date(),
    );
    await runDigest(
      db,
      { hn: countingHn().hn, ai: keywordFilter("bitcoin") },
      "bitcoin",
      1,
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
      0,
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
      1,
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

  it("skips stories already evaluated at the current preference version", async () => {
    const db = getDb(env);
    const first = countingFilter("rust");
    await runDigest(
      db,
      { hn: countingHn().hn, ai: first.ai },
      "rust",
      1,
      USER,
      new Date(),
    );
    expect(first.seen).toEqual([2]);

    // Same version + same front page → nothing is re-sent to the AI (the Rust
    // verdict AND the non-relevant Bitcoin verdict are both reused).
    const second = countingFilter("rust");
    await runDigest(
      db,
      { hn: countingHn().hn, ai: second.ai },
      "rust",
      1,
      USER,
      new Date(),
    );
    expect(second.seen).toEqual([0]);

    const feed = await db
      .select()
      .from(curations)
      .where(and(eq(curations.userEmail, USER), eq(curations.current, true)));
    expect(feed.map((c) => c.storyId)).toEqual([1]);
  });

  it("re-evaluates every front-page story after a version bump", async () => {
    const db = getDb(env);
    await runDigest(
      db,
      { hn: countingHn().hn, ai: keywordFilter("rust") },
      "rust",
      1,
      USER,
      new Date(),
    );
    const next = countingFilter("rust");
    await runDigest(
      db,
      { hn: countingHn().hn, ai: next.ai },
      "rust",
      2,
      USER,
      new Date(),
    );
    expect(next.seen).toEqual([2]);
  });

  it("evaluates only newly appeared stories at the same version", async () => {
    const db = getDb(env);
    const t0 = new Date("2026-06-17T06:20:00Z");
    await runDigest(
      db,
      { hn: countingHn().hn, ai: keywordFilter("rust") },
      "rust",
      1,
      USER,
      t0,
    );
    const withNew: HnClient = {
      frontPage: () =>
        Promise.resolve([
          ...FRONT,
          {
            id: 3,
            title: "Rust tooling roundup",
            url: "https://e.com/r2",
            by: "carol",
            score: 70,
            comments: 3,
            time: 1700000200,
          },
        ]),
    };
    const counter = countingFilter("rust");
    // Past the rate-limit window, so the new story is fetched and picked up.
    await runDigest(
      db,
      { hn: withNew, ai: counter.ai },
      "rust",
      1,
      USER,
      new Date(t0.getTime() + 6 * 60_000),
    );
    expect(counter.seen).toEqual([1]);

    const feed = await db
      .select()
      .from(curations)
      .where(and(eq(curations.userEmail, USER), eq(curations.current, true)));
    expect(feed.map((c) => c.storyId).sort((a, b) => a - b)).toEqual([1, 3]);
  });

  it("reuses the cached snapshot without re-fetching HN within the window", async () => {
    const db = getDb(env);
    const t0 = new Date("2026-06-17T06:20:00Z");
    await runDigest(
      db,
      { hn: countingHn().hn, ai: keywordFilter("rust") },
      "rust",
      1,
      "a@x.test",
      t0,
    );

    // A second user one minute later: no HN fetch, but they still get a feed
    // built from the cached snapshot, evaluating their own (un-judged) candidates.
    const hnB = countingHn();
    const filterB = countingFilter("bitcoin");
    await runDigest(
      db,
      { hn: hnB.hn, ai: filterB.ai },
      "bitcoin",
      1,
      "b@x.test",
      new Date(t0.getTime() + 60_000),
    );
    expect(hnB.fetches()).toBe(0);
    expect(filterB.seen).toEqual([FRONT.length]);

    const feedB = await db
      .select()
      .from(curations)
      .where(
        and(eq(curations.userEmail, "b@x.test"), eq(curations.current, true)),
      );
    expect(feedB.map((c) => c.storyId)).toEqual([2]);
  });

  it("sends nothing to the AI for a within-window re-run at the same version", async () => {
    const db = getDb(env);
    const t0 = new Date("2026-06-17T06:20:00Z");
    await runDigest(
      db,
      { hn: countingHn().hn, ai: keywordFilter("rust") },
      "rust",
      1,
      USER,
      t0,
    );

    const hn = countingHn();
    const again = countingFilter("rust");
    const result = await runDigest(
      db,
      { hn: hn.hn, ai: again.ai },
      "rust",
      1,
      USER,
      new Date(t0.getTime() + 2 * 60_000),
    );
    expect(hn.fetches()).toBe(0);
    expect(again.seen).toEqual([0]);
    expect(result.count).toBe(1);

    const feed = await db
      .select()
      .from(curations)
      .where(and(eq(curations.userEmail, USER), eq(curations.current, true)));
    expect(feed.map((c) => c.storyId)).toEqual([1]);
  });

  it("fetches HN again once the rate-limit window has elapsed", async () => {
    const db = getDb(env);
    const t0 = new Date("2026-06-17T06:20:00Z");
    await runDigest(
      db,
      { hn: countingHn().hn, ai: keywordFilter("rust") },
      "rust",
      1,
      USER,
      t0,
    );

    const later = countingHn();
    await runDigest(
      db,
      { hn: later.hn, ai: keywordFilter("rust") },
      "rust",
      1,
      USER,
      new Date(t0.getTime() + 6 * 60_000),
    );
    expect(later.fetches()).toBe(1);
  });
});
