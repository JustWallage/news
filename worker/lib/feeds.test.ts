import { env } from "cloudflare:workers";
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { feedItems, feedSources, feeds } from "../../db/schema";
import { getDb } from "./db";
import type { AiFilter } from "./digest";
import { fakeAiFilter } from "./fakes";
import {
  addFeedSource,
  createFeed,
  deleteFeed,
  loadFeedArchive,
  loadFeedForUser,
  loadFeedItems,
  loadUnsentFeedItems,
  markFeedItemsSent,
  runFeedFetch,
  updateFeed,
} from "./feeds";
import type { ParsedFeedItem, RssClient } from "./rss";
import { RssFetchError } from "./rss";

const USER = "user@example.test";
const NOW = new Date("2026-07-15T10:00:00Z");

function item(slug: string, minutesAgo = 0): ParsedFeedItem {
  return {
    title: `Article about ${slug}`,
    link: `https://src.example.com/${slug}`,
    publishedAt: new Date(NOW.getTime() - minutesAgo * 60_000),
  };
}

// RSS client serving a canned channel per URL; URLs containing "down" fail.
function cannedRss(channels: Record<string, ParsedFeedItem[]>): RssClient {
  return {
    fetch: (url) => {
      if (url.includes("down")) {
        return Promise.reject(new RssFetchError("Could not reach that URL"));
      }
      return Promise.resolve({
        title: `Channel ${url}`,
        items: channels[url] ?? [],
      });
    },
  };
}

// AI filter that records what it was asked to judge (fake keyword logic inside).
function countingAi(): { ai: AiFilter; judged: () => number } {
  let judged = 0;
  return {
    judged: () => judged,
    ai: {
      select: (prefs, stories) => fakeAiFilter.select(prefs, stories),
      selectFeedItems: (prefs, items) => {
        judged += items.length;
        return fakeAiFilter.selectFeedItems(prefs, items);
      },
    },
  };
}

async function makeFeed(preferencesText = ""): Promise<number> {
  const db = getDb(env);
  const id = await createFeed(db, USER, "Test feed", NOW);
  if (preferencesText !== "") {
    const feed = await loadFeedForUser(db, USER, id);
    if (feed === null) {
      throw new Error("feed vanished");
    }
    await updateFeed(db, feed, { title: feed.title, preferencesText });
  }
  return id;
}

async function feedById(id: number) {
  const feed = await loadFeedForUser(getDb(env), USER, id);
  if (feed === null) {
    throw new Error("feed vanished");
  }
  return feed;
}

beforeEach(async () => {
  const db = getDb(env);
  await db.delete(feedItems);
  await db.delete(feedSources);
  await db.delete(feeds);
});

describe("updateFeed", () => {
  it("bumps prefVersion only on a real preferences change", async () => {
    const db = getDb(env);
    const id = await makeFeed();
    const created = await feedById(id);
    expect(created.prefVersion).toBe(1);

    await updateFeed(db, created, { title: "Renamed", preferencesText: "" });
    expect((await feedById(id)).prefVersion).toBe(1);

    await updateFeed(db, await feedById(id), {
      title: "Renamed",
      preferencesText: "rust",
    });
    expect((await feedById(id)).prefVersion).toBe(2);

    await updateFeed(db, await feedById(id), {
      title: "Renamed",
      preferencesText: "rust",
    });
    expect((await feedById(id)).prefVersion).toBe(2);
  });
});

describe("addFeedSource", () => {
  it("stores a source with its channel title, refusing duplicates and the cap", async () => {
    const db = getDb(env);
    const id = await makeFeed();
    const rss = cannedRss({ "https://a.example.com/feed": [item("a")] });

    const added = await addFeedSource(
      db,
      rss,
      await feedById(id),
      "https://a.example.com/feed",
      NOW,
    );
    expect(added.ok).toBe(true);
    if (added.ok) {
      expect(added.source.title).toBe("Channel https://a.example.com/feed");
    }

    const duplicate = await addFeedSource(
      db,
      rss,
      await feedById(id),
      "https://a.example.com/feed",
      NOW,
    );
    expect(duplicate).toMatchObject({ ok: false, reason: "duplicate" });

    for (let i = 0; i < 9; i++) {
      const more = await addFeedSource(
        db,
        rss,
        await feedById(id),
        `https://a.example.com/feed-${String(i)}`,
        NOW,
      );
      expect(more.ok).toBe(true);
    }
    const overCap = await addFeedSource(
      db,
      rss,
      await feedById(id),
      "https://a.example.com/one-too-many",
      NOW,
    );
    expect(overCap).toMatchObject({ ok: false, reason: "limit" });
  });

  it("refuses a source whose URL does not fetch as a feed", async () => {
    const db = getDb(env);
    const id = await makeFeed();
    const result = await addFeedSource(
      db,
      cannedRss({}),
      await feedById(id),
      "https://down.example.com/feed",
      NOW,
    );
    expect(result).toMatchObject({ ok: false, reason: "unreachable" });
    expect(await db.select().from(feedSources)).toHaveLength(0);
  });
});

describe("runFeedFetch", () => {
  async function withSource(feedId: number, url: string): Promise<void> {
    await getDb(env)
      .insert(feedSources)
      .values({ feedId, url, title: "t", createdAt: NOW });
  }

  it("dedupes by link across sources and marks current = relevant", async () => {
    const db = getDb(env);
    const id = await makeFeed("rust");
    await withSource(id, "https://a.example.com/feed");
    await withSource(id, "https://b.example.com/feed");
    const shared = item("rust-shared");
    const rss = cannedRss({
      "https://a.example.com/feed": [
        shared,
        item("rust-only-a"),
        item("cooking"),
      ],
      "https://b.example.com/feed": [shared, item("rust-only-b")],
    });

    const result = await runFeedFetch(
      db,
      { rss, ai: fakeAiFilter },
      await feedById(id),
      NOW,
    );

    expect(result.count).toBe(3);
    const rows = await db.select().from(feedItems);
    expect(rows).toHaveLength(4);
    const byLink = new Map(rows.map((r) => [r.link, r]));
    expect(byLink.get("https://src.example.com/rust-shared")?.current).toBe(
      true,
    );
    expect(byLink.get("https://src.example.com/cooking")?.current).toBe(false);
    expect(byLink.get("https://src.example.com/cooking")?.relevant).toBe(false);
    expect((await feedById(id)).lastFetchedAt?.getTime()).toBe(NOW.getTime());
  });

  it("reuses verdicts at the current prefVersion and re-judges after an edit", async () => {
    const db = getDb(env);
    const id = await makeFeed("rust");
    await withSource(id, "https://a.example.com/feed");
    const rss = cannedRss({
      "https://a.example.com/feed": [item("rust-1"), item("cooking-1")],
    });

    const first = countingAi();
    await runFeedFetch(db, { rss, ai: first.ai }, await feedById(id), NOW);
    expect(first.judged()).toBe(2);

    const second = countingAi();
    await runFeedFetch(db, { rss, ai: second.ai }, await feedById(id), NOW);
    expect(second.judged()).toBe(0);

    await updateFeed(db, await feedById(id), {
      title: "Test feed",
      preferencesText: "cooking",
    });
    const third = countingAi();
    await runFeedFetch(db, { rss, ai: third.ai }, await feedById(id), NOW);
    expect(third.judged()).toBe(2);
    const rows = await db.select().from(feedItems);
    const cooking = rows.find((r) => r.link.endsWith("cooking-1"));
    expect(cooking?.relevant).toBe(true);
    expect(cooking?.current).toBe(true);
  });

  it("marks everything relevant without touching the AI when preferences are empty", async () => {
    const db = getDb(env);
    const id = await makeFeed();
    await withSource(id, "https://a.example.com/feed");
    const rss = cannedRss({
      "https://a.example.com/feed": [item("anything"), item("at-all")],
    });
    const ai: AiFilter = {
      select: () => Promise.reject(new Error("AI must not run")),
      selectFeedItems: () => Promise.reject(new Error("AI must not run")),
    };

    const result = await runFeedFetch(db, { rss, ai }, await feedById(id), NOW);

    expect(result.count).toBe(2);
    expect((await db.select().from(feedItems)).every((r) => r.relevant)).toBe(
      true,
    );
  });

  it("survives a failing source and still ingests the healthy ones", async () => {
    const db = getDb(env);
    const id = await makeFeed("rust");
    await withSource(id, "https://down.example.com/feed");
    await withSource(id, "https://a.example.com/feed");
    const rss = cannedRss({ "https://a.example.com/feed": [item("rust-ok")] });

    const result = await runFeedFetch(
      db,
      { rss, ai: fakeAiFilter },
      await feedById(id),
      NOW,
    );

    expect(result.count).toBe(1);
    expect(await db.select().from(feedItems)).toHaveLength(1);
  });

  it("preserves sentAt across refetches", async () => {
    const db = getDb(env);
    const id = await makeFeed("rust");
    await withSource(id, "https://a.example.com/feed");
    const rss = cannedRss({ "https://a.example.com/feed": [item("rust-1")] });

    await runFeedFetch(db, { rss, ai: fakeAiFilter }, await feedById(id), NOW);
    const [row] = await db.select().from(feedItems);
    expect(row).toBeDefined();
    if (row === undefined) {
      return;
    }
    await markFeedItemsSent(db, [row.id], NOW);

    const later = new Date(NOW.getTime() + 60 * 60 * 1000);
    await runFeedFetch(
      db,
      { rss, ai: fakeAiFilter },
      await feedById(id),
      later,
    );
    const [after] = await db.select().from(feedItems);
    expect(after?.sentAt?.getTime()).toBe(NOW.getTime());
    expect(after?.fetchedAt.getTime()).toBe(later.getTime());
  });

  it("does not stamp lastFetchedAt when the feed has no sources", async () => {
    const db = getDb(env);
    const id = await makeFeed();
    const result = await runFeedFetch(
      db,
      { rss: cannedRss({}), ai: fakeAiFilter },
      await feedById(id),
      NOW,
    );
    expect(result.count).toBe(0);
    expect((await feedById(id)).lastFetchedAt).toBeNull();
  });
});

describe("item queries", () => {
  async function seedItems(
    feedId: number,
    rows: {
      slug: string;
      relevant?: boolean;
      current?: boolean;
      publishedAt?: Date | null;
      sentAt?: Date | null;
    }[],
  ): Promise<void> {
    const db = getDb(env);
    for (const row of rows) {
      await db.insert(feedItems).values({
        feedId,
        link: `https://src.example.com/${row.slug}`,
        title: row.slug,
        publishedAt: row.publishedAt === undefined ? NOW : row.publishedAt,
        fetchedAt: NOW,
        relevant: row.relevant ?? true,
        relevanceScore: 50,
        prefVersion: 1,
        current: row.current ?? true,
        sentAt: row.sentAt ?? null,
      });
    }
  }

  it("pages the newest 20 current items, undated ones last", async () => {
    const id = await makeFeed();
    await seedItems(
      id,
      Array.from({ length: 25 }, (_unused, i) => ({
        slug: `dated-${String(i)}`,
        publishedAt: new Date(NOW.getTime() - i * 60_000),
      })),
    );
    await seedItems(id, [
      { slug: "undated", publishedAt: null },
      { slug: "not-current", current: false },
    ]);

    const page = await loadFeedItems(getDb(env), id);

    expect(page).toHaveLength(20);
    expect(page[0]?.title).toBe("dated-0");
    expect(page.some((r) => r.title === "not-current")).toBe(false);
    expect(page.some((r) => r.title === "undated")).toBe(false);

    await getDb(env).delete(feedItems).where(eq(feedItems.feedId, id));
    await seedItems(id, [
      { slug: "undated", publishedAt: null },
      { slug: "dated", publishedAt: NOW },
    ]);
    const small = await loadFeedItems(getDb(env), id);
    expect(small.map((r) => r.title)).toEqual(["dated", "undated"]);
  });

  it("archives every relevant item ever, and only those", async () => {
    const id = await makeFeed();
    await seedItems(id, [
      { slug: "current-relevant" },
      { slug: "old-relevant", current: false },
      { slug: "never-relevant", relevant: false, current: false },
    ]);

    const archive = await loadFeedArchive(getDb(env), id);

    expect(archive.map((r) => r.title).sort()).toEqual([
      "current-relevant",
      "old-relevant",
    ]);
  });

  it("selects only never-sent current items and stamps them sent", async () => {
    const db = getDb(env);
    const id = await makeFeed();
    await seedItems(id, [
      { slug: "fresh" },
      { slug: "already-sent", sentAt: NOW },
      { slug: "gone", current: false },
    ]);

    const unsent = await loadUnsentFeedItems(db, id);
    expect(unsent.map((r) => r.title)).toEqual(["fresh"]);

    await markFeedItemsSent(
      db,
      unsent.map((r) => r.id),
      NOW,
    );
    expect(await loadUnsentFeedItems(db, id)).toHaveLength(0);
  });
});

describe("deleteFeed", () => {
  it("removes the feed with its sources and items", async () => {
    const db = getDb(env);
    const id = await makeFeed();
    await db.insert(feedSources).values({
      feedId: id,
      url: "https://a.example.com/feed",
      title: "t",
      createdAt: NOW,
    });
    await db.insert(feedItems).values({
      feedId: id,
      link: "https://src.example.com/x",
      title: "x",
      fetchedAt: NOW,
      current: true,
    });

    await deleteFeed(db, id);

    expect(await db.select().from(feeds)).toHaveLength(0);
    expect(await db.select().from(feedSources)).toHaveLength(0);
    expect(await db.select().from(feedItems)).toHaveLength(0);
  });
});

describe("loadFeedForUser", () => {
  it("hides another user's feed", async () => {
    const id = await makeFeed();
    expect(
      await loadFeedForUser(getDb(env), "other@example.test", id),
    ).toBeNull();
    expect(await loadFeedForUser(getDb(env), USER, id)).not.toBeNull();
  });
});
