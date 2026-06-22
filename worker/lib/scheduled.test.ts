import { env } from "cloudflare:workers";
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { curations, preferences, stories, telegram } from "../../db/schema";
import { getDb } from "./db";
import type { AiFilter, StoryInput } from "./digest";
import { fakeAiFilter } from "./fakes";
import type { HnClient } from "./hn";
import { runTelegramDigests, sendDailyDigest } from "./scheduled";
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

const hn: HnClient = { frontPage: () => Promise.resolve(FRONT) };

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

const aiFilter: AiFilter = fakeAiFilter;

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
    const rec = recordingTelegram();

    await sendDailyDigest(
      db,
      { hn, ai: aiFilter, telegram: rec.telegram },
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

describe("runTelegramDigests", () => {
  const now = new Date("2026-06-17T06:05:00Z"); // 08:05 Amsterdam, 02:05 New York
  const minute = minuteOfDayInTz(now, "Europe/Amsterdam");

  it("runs the digest only when a slot matches the current minute (null tz → Amsterdam)", async () => {
    const db = getDb(env);
    await db
      .insert(telegram)
      .values({ userEmail: USER, chatId: CHAT, slot1: minute + 5 });

    await runTelegramDigests(env, now);
    expect(await db.select().from(stories)).toHaveLength(0);

    await db
      .update(telegram)
      .set({ slot1: minute })
      .where(eq(telegram.userEmail, USER));
    await runTelegramDigests(env, now);
    expect((await db.select().from(stories)).length).toBeGreaterThan(0);
  });

  it("matches the slot in the user's timezone, not Amsterdam", async () => {
    const db = getDb(env);
    const nyMinute = minuteOfDayInTz(now, "America/New_York");
    expect(nyMinute).not.toBe(minute);

    // A slot at the Amsterdam minute must not fire for a New York user.
    await db.insert(telegram).values({
      userEmail: USER,
      chatId: CHAT,
      slot1: minute,
      timezone: "America/New_York",
    });
    await runTelegramDigests(env, now);
    expect(await db.select().from(stories)).toHaveLength(0);

    // The same slot at the New York minute fires.
    await db
      .update(telegram)
      .set({ slot1: nyMinute })
      .where(eq(telegram.userEmail, USER));
    await runTelegramDigests(env, now);
    expect((await db.select().from(stories)).length).toBeGreaterThan(0);
  });

  it("does nothing when the chat is not linked", async () => {
    const db = getDb(env);
    await db
      .insert(telegram)
      .values({ userEmail: USER, chatId: null, slot1: minute });
    await runTelegramDigests(env, now);
    expect(await db.select().from(stories)).toHaveLength(0);
  });
});
