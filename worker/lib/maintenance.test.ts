import { env } from "cloudflare:workers";
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { feedItems, feeds, sessions, telegram } from "../../db/schema";
import { getDb } from "./db";
import { purgeExpired } from "./maintenance";
import { createSession } from "./session";

const USER = "user@example.test";

beforeEach(async () => {
  const db = getDb(env);
  await db.delete(sessions);
  await db.delete(telegram);
  await db.delete(feedItems);
  await db.delete(feeds);
});

describe("purgeExpired", () => {
  it("deletes expired sessions and keeps live ones", async () => {
    const db = getDb(env);
    const now = new Date("2026-06-22T03:00:00Z");
    // Live session (created now) vs an already-expired one.
    await createSession(db, USER, now);
    await db.insert(sessions).values({
      id: "expired",
      userEmail: USER,
      expiresAt: new Date(now.getTime() - 1000),
    });

    await purgeExpired(db, now);

    const rows = await db.select().from(sessions);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.id).not.toBe("expired");
  });

  it("clears an expired link code but keeps the chat link", async () => {
    const db = getDb(env);
    const now = new Date("2026-06-22T03:00:00Z");
    await db.insert(telegram).values({
      userEmail: USER,
      chatId: 4242,
      timezone: "America/New_York",
      linkCode: "deadbeefdeadbeef",
      linkCodeExpiresAt: new Date(now.getTime() - 1000),
    });

    await purgeExpired(db, now);

    const rows = await db
      .select()
      .from(telegram)
      .where(eq(telegram.userEmail, USER));
    expect(rows).toHaveLength(1);
    expect(rows[0]?.linkCode).toBeNull();
    expect(rows[0]?.linkCodeExpiresAt).toBeNull();
    // The chat binding and timezone survive the purge.
    expect(rows[0]?.chatId).toBe(4242);
    expect(rows[0]?.timezone).toBe("America/New_York");
  });

  it("leaves an unexpired link code untouched", async () => {
    const db = getDb(env);
    const now = new Date("2026-06-22T03:00:00Z");
    await db.insert(telegram).values({
      userEmail: USER,
      linkCode: "stillvalidcode00",
      linkCodeExpiresAt: new Date(now.getTime() + 60_000),
    });

    await purgeExpired(db, now);

    const rows = await db.select().from(telegram);
    expect(rows[0]?.linkCode).toBe("stillvalidcode00");
  });

  it("prunes only stale never-relevant feed items — the archive survives", async () => {
    const db = getDb(env);
    const now = new Date("2026-06-22T03:00:00Z");
    const stale = new Date(now.getTime() - 61 * 24 * 60 * 60 * 1000);
    const feedRows = await db
      .insert(feeds)
      .values({ userEmail: USER, title: "f", createdAt: now })
      .returning({ id: feeds.id });
    const feedId = feedRows[0]?.id ?? 0;
    const item = (
      link: string,
      relevant: boolean,
      current: boolean,
      fetchedAt: Date,
    ) => ({
      feedId,
      link,
      title: link,
      fetchedAt,
      relevant,
      current,
    });
    await db
      .insert(feedItems)
      .values([
        item("stale-irrelevant", false, false, stale),
        item("fresh-irrelevant", false, false, now),
        item("stale-relevant-archive", true, false, stale),
        item("stale-but-current", false, true, stale),
      ]);

    await purgeExpired(db, now);

    const kept = (await db.select().from(feedItems)).map((r) => r.link).sort();
    expect(kept).toEqual([
      "fresh-irrelevant",
      "stale-but-current",
      "stale-relevant-archive",
    ]);
  });
});
