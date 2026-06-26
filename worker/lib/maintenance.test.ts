import { env } from "cloudflare:workers";
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { sessions, telegram } from "../../db/schema";
import { getDb } from "./db";
import { purgeExpired } from "./maintenance";
import { createSession } from "./session";

const USER = "user@example.test";

beforeEach(async () => {
  const db = getDb(env);
  await db.delete(sessions);
  await db.delete(telegram);
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
});
