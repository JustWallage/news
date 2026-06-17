import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { curations, preferences, stories } from "../../db/schema";
import { getDb } from "./db";
import type { AiFilter, StoryInput } from "./digest";
import { fakeAiFilter } from "./fakes";
import type { HnClient } from "./hn";
import { sendDailyDigest } from "./scheduled";
import type { TelegramClient } from "./telegram";

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
