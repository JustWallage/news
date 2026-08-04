import { env } from "cloudflare:workers";
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import {
  curations,
  feedItems,
  feedSources,
  feeds,
  preferences,
  stories,
  telegram,
} from "../../db/schema";
import { getDb } from "./db";
import type { Deps } from "./deps";
import type { AiFilter, StoryInput } from "./digest";
import { fakeAiFilter, fakeRssClient } from "./fakes";
import type { HnClient } from "./hn";
import {
  sendDailyDigest,
  sendDueDigests,
  sendDueFeedDigests,
} from "./scheduled";
import type { TelegramClient } from "./telegram";
import { minuteOfDayInTz } from "./time";

const USER = "user@example.test";
const CHAT = 4242;
const APP = "https://news.justwallage.nl";

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

// HN client that records how many times the front page was fetched, so a test
// can assert the cron queries HN at most once per tick.
function countingHn(): { hn: HnClient; calls: () => number } {
  let calls = 0;
  return {
    calls: () => calls,
    hn: {
      frontPage: () => {
        calls += 1;
        return Promise.resolve(FRONT);
      },
    },
  };
}

function recordingTelegram(): {
  telegram: TelegramClient;
  sent: { chatId: number; text: string }[];
} {
  const sent: { chatId: number; text: string }[] = [];
  return {
    sent,
    telegram: {
      sendMessage: (chatId, text) => {
        sent.push({ chatId, text });
        return Promise.resolve();
      },
    },
  };
}

const ai: AiFilter = fakeAiFilter;

beforeEach(async () => {
  const db = getDb(env);
  await db.delete(curations);
  await db.delete(stories);
  await db.delete(preferences);
  await db.delete(telegram);
  await db.delete(feedItems);
  await db.delete(feedSources);
  await db.delete(feeds);
});

describe("sendDailyDigest", () => {
  it("re-runs the digest and sends the curated feed to the chat", async () => {
    const db = getDb(env);
    await db
      .insert(preferences)
      .values({ userEmail: USER, text: "rust", updatedAt: new Date() });
    const { hn } = countingHn();
    const rec = recordingTelegram();

    await sendDailyDigest(
      db,
      { hn, ai, rss: fakeRssClient, telegram: rec.telegram },
      USER,
      CHAT,
      APP,
      new Date(),
    );

    expect(rec.sent).toHaveLength(1);
    expect(rec.sent[0]?.chatId).toBe(CHAT);
    expect(rec.sent[0]?.text).toContain("Rust rocks");
    expect(rec.sent[0]?.text).not.toContain("Bitcoin");
    expect(rec.sent[0]?.text).toContain(APP);
  });
});

describe("sendDueDigests", () => {
  const now = new Date("2026-06-17T06:05:00Z"); // 08:05 Amsterdam, 02:05 New York
  const minute = minuteOfDayInTz(now, "Europe/Amsterdam");

  function deps(): { deps: Deps; calls: () => number; sent: () => number } {
    const { hn, calls } = countingHn();
    const rec = recordingTelegram();
    return {
      deps: { hn, ai, rss: fakeRssClient, telegram: rec.telegram },
      calls,
      sent: () => rec.sent.length,
    };
  }

  it("does not query HN when no user is due", async () => {
    const db = getDb(env);
    await db
      .insert(telegram)
      .values({ userEmail: USER, chatId: CHAT, slot1: minute + 5 });
    const d = deps();

    await sendDueDigests(db, d.deps, APP, now);

    expect(d.calls()).toBe(0);
    expect(d.sent()).toBe(0);
    expect(await db.select().from(stories)).toHaveLength(0);
  });

  it("fetches HN once and serves every due user", async () => {
    const db = getDb(env);
    await db.insert(preferences).values([
      { userEmail: "a@x.com", text: "rust", updatedAt: now },
      { userEmail: "b@x.com", text: "rust", updatedAt: now },
      { userEmail: "c@x.com", text: "rust", updatedAt: now },
    ]);
    await db.insert(telegram).values([
      { userEmail: "a@x.com", chatId: 1, slot1: minute },
      { userEmail: "b@x.com", chatId: 2, slot2: minute },
      { userEmail: "c@x.com", chatId: 3, slot1: minute + 5 },
    ]);
    const d = deps();

    await sendDueDigests(db, d.deps, APP, now);

    expect(d.calls()).toBe(1);
    expect(d.sent()).toBe(2);
    const curatedUsers = (await db.select().from(curations)).map(
      (r) => r.userEmail,
    );
    expect(new Set(curatedUsers)).toEqual(new Set(["a@x.com", "b@x.com"]));
  });

  it("matches the slot in the user's timezone, not Amsterdam", async () => {
    const db = getDb(env);
    const nyMinute = minuteOfDayInTz(now, "America/New_York");
    expect(nyMinute).not.toBe(minute);
    await db
      .insert(preferences)
      .values({ userEmail: USER, text: "rust", updatedAt: now });

    // A slot at the Amsterdam minute must not fire for a New York user.
    await db.insert(telegram).values({
      userEmail: USER,
      chatId: CHAT,
      slot1: minute,
      timezone: "America/New_York",
    });
    const before = deps();
    await sendDueDigests(db, before.deps, APP, now);
    expect(before.sent()).toBe(0);
    expect(await db.select().from(stories)).toHaveLength(0);

    // The same slot at the New York minute fires.
    await db
      .update(telegram)
      .set({ slot1: nyMinute })
      .where(eq(telegram.userEmail, USER));
    const after = deps();
    await sendDueDigests(db, after.deps, APP, now);
    expect(after.sent()).toBe(1);
  });

  it("does nothing when the chat is not linked", async () => {
    const db = getDb(env);
    await db
      .insert(telegram)
      .values({ userEmail: USER, chatId: null, slot1: minute });
    const d = deps();

    await sendDueDigests(db, d.deps, APP, now);

    expect(d.calls()).toBe(0);
    expect(await db.select().from(stories)).toHaveLength(0);
  });
});

describe("sendDueFeedDigests", () => {
  const now = new Date("2026-06-17T06:05:00Z");
  const minute = minuteOfDayInTz(now, "Europe/Amsterdam");

  async function seedFeed(slot: number | null): Promise<number> {
    const db = getDb(env);
    const rows = await db
      .insert(feeds)
      .values({
        userEmail: USER,
        title: "Dev blogs",
        preferencesText: "rust",
        slot1: slot,
        createdAt: now,
      })
      .returning({ id: feeds.id });
    const id = rows[0]?.id ?? 0;
    await db.insert(feedSources).values({
      feedId: id,
      url: "https://blogs.example.com/feed",
      title: "Fake Feed",
      createdAt: now,
    });
    return id;
  }

  function feedDeps(): {
    deps: Deps;
    sent: { chatId: number; text: string }[];
  } {
    const rec = recordingTelegram();
    return {
      deps: {
        hn: countingHn().hn,
        ai,
        rss: fakeRssClient,
        telegram: rec.telegram,
      },
      sent: rec.sent,
    };
  }

  it("sends a due feed's new items once, then reports nothing new", async () => {
    const db = getDb(env);
    await db.insert(telegram).values({ userEmail: USER, chatId: CHAT });
    await seedFeed(minute);

    const first = feedDeps();
    await sendDueFeedDigests(db, first.deps, APP, now);
    expect(first.sent).toHaveLength(1);
    expect(first.sent[0]?.chatId).toBe(CHAT);
    expect(first.sent[0]?.text).toContain("Rust in the kernel");
    expect(first.sent[0]?.text).not.toContain("Sample article");
    expect(first.sent[0]?.text).toContain(`${APP}/feeds`);

    // The same item is never delivered twice, even though it is still current.
    const second = feedDeps();
    await sendDueFeedDigests(db, second.deps, APP, now);
    expect(second.sent).toHaveLength(1);
    expect(second.sent[0]?.text).toContain("No new items");
    expect(second.sent[0]?.text).not.toContain("Rust in the kernel");
  });

  it("still delivers a relevant item that fell out of the current fetch", async () => {
    const db = getDb(env);
    await db.insert(telegram).values({ userEmail: USER, chatId: CHAT });
    const feedId = await seedFeed(minute);
    // A verdict from an earlier run whose article has since left the RSS window:
    // current=false, never sent. Losing it would be silent data loss.
    const longAgo = new Date("2025-12-01T00:00:00Z");
    await db.insert(feedItems).values({
      feedId,
      link: "https://blogs.example.com/articles/rust-gone",
      title: "Rust feature that scrolled away",
      publishedAt: longAgo,
      fetchedAt: longAgo,
      relevant: true,
      relevanceScore: 80,
      prefVersion: 1,
      current: false,
    });

    const run = feedDeps();
    await sendDueFeedDigests(db, run.deps, APP, now);

    const text = run.sent[0]?.text ?? "";
    expect(text).toContain("Rust feature that scrolled away");
    expect(text).toContain("Rust in the kernel");
    // Oldest first: the stranded item drains ahead of this run's fresh pick.
    expect(text.indexOf("scrolled away")).toBeLessThan(
      text.indexOf("Rust in the kernel"),
    );
    const sentRows = (await db.select().from(feedItems)).filter(
      (r) => r.sentAt !== null,
    );
    expect(sentRows).toHaveLength(2);
  });

  it("skips feeds that are not due or whose owner has no chat", async () => {
    const db = getDb(env);
    await db.insert(telegram).values({ userEmail: USER, chatId: CHAT });
    await seedFeed(minute + 5);
    const notDue = feedDeps();
    await sendDueFeedDigests(db, notDue.deps, APP, now);
    expect(notDue.sent).toHaveLength(0);

    await db.delete(telegram).where(eq(telegram.userEmail, USER));
    await db.update(feeds).set({ slot1: minute });
    const noChat = feedDeps();
    await sendDueFeedDigests(db, noChat.deps, APP, now);
    expect(noChat.sent).toHaveLength(0);
  });

  it("matches the feed slot in the owner's timezone", async () => {
    const db = getDb(env);
    const nyMinute = minuteOfDayInTz(now, "America/New_York");
    await db.insert(telegram).values({
      userEmail: USER,
      chatId: CHAT,
      timezone: "America/New_York",
    });
    await seedFeed(minute);
    const wrongZone = feedDeps();
    await sendDueFeedDigests(db, wrongZone.deps, APP, now);
    expect(wrongZone.sent).toHaveLength(0);

    await db.update(feeds).set({ slot1: nyMinute });
    const rightZone = feedDeps();
    await sendDueFeedDigests(db, rightZone.deps, APP, now);
    expect(rightZone.sent).toHaveLength(1);
  });
});
