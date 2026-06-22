import { env } from "cloudflare:workers";
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { curations, preferences, stories, telegram } from "../../db/schema";
import { getDb } from "./db";
import type { Deps } from "./deps";
import type { AiFilter, StoryInput } from "./digest";
import { fakeAiFilter } from "./fakes";
import type { HnClient } from "./hn";
import { sendDailyDigest, sendDueDigests } from "./scheduled";
import type { TelegramClient } from "./telegram";
import { minuteOfDayInTz } from "./time";

const USER = "just@wallage.nl";
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
      { hn, ai, telegram: rec.telegram },
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
      deps: { hn, ai, telegram: rec.telegram },
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
