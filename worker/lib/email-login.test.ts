import { env } from "cloudflare:workers";
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { emailLoginCodes } from "../../db/schema";
import { getDb } from "./db";
import {
  generateOtp,
  normalizeEmail,
  OTP_MAX_ATTEMPTS,
  OTP_RESEND_COOLDOWN_MS,
  OTP_TTL_MS,
  purgeExpiredCodes,
  requestCode,
  verifyCode,
} from "./email-login";

const EMAIL = "user@example.com";

beforeEach(async () => {
  await getDb(env).delete(emailLoginCodes);
});

function codeOf(result: { code: string } | { retryAfterMs: number }): string {
  if (!("code" in result)) {
    throw new Error("expected a code, got a throttle");
  }
  return result.code;
}

describe("generateOtp", () => {
  it("returns a 6-digit numeric string", () => {
    for (let i = 0; i < 100; i++) {
      expect(generateOtp()).toMatch(/^\d{6}$/);
    }
  });
});

describe("normalizeEmail", () => {
  it("trims and lowercases", () => {
    expect(normalizeEmail("  User@Example.COM ")).toBe("user@example.com");
  });
});

describe("requestCode", () => {
  it("issues a code and stores it hashed (not in clear)", async () => {
    const db = getDb(env);
    const now = new Date("2026-06-22T10:00:00Z");
    const code = codeOf(await requestCode(db, EMAIL, now));

    const rows = await db.select().from(emailLoginCodes);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.codeHash).not.toBe(code);
    expect(rows[0]?.attempts).toBe(0);
  });

  it("throttles a resend inside the cooldown window", async () => {
    const db = getDb(env);
    const now = new Date("2026-06-22T10:00:00Z");
    await requestCode(db, EMAIL, now);

    const again = await requestCode(
      db,
      EMAIL,
      new Date(now.getTime() + OTP_RESEND_COOLDOWN_MS - 1),
    );
    expect("retryAfterMs" in again).toBe(true);
  });

  it("issues a fresh code once the cooldown has passed", async () => {
    const db = getDb(env);
    const now = new Date("2026-06-22T10:00:00Z");
    await requestCode(db, EMAIL, now);

    const later = new Date(now.getTime() + OTP_RESEND_COOLDOWN_MS);
    expect("code" in (await requestCode(db, EMAIL, later))).toBe(true);
  });
});

describe("verifyCode", () => {
  it("accepts the right code once and consumes it", async () => {
    const db = getDb(env);
    const now = new Date("2026-06-22T10:00:00Z");
    const code = codeOf(await requestCode(db, EMAIL, now));

    expect(await verifyCode(db, EMAIL, code, now)).toBe(true);
    expect(await db.select().from(emailLoginCodes)).toHaveLength(0);
    // Single-use: a replay of the same code now fails.
    expect(await verifyCode(db, EMAIL, code, now)).toBe(false);
  });

  it("rejects a wrong code and counts the attempt", async () => {
    const db = getDb(env);
    const now = new Date("2026-06-22T10:00:00Z");
    const code = codeOf(await requestCode(db, EMAIL, now));
    const wrong = code === "000000" ? "111111" : "000000";

    expect(await verifyCode(db, EMAIL, wrong, now)).toBe(false);
    const rows = await db
      .select()
      .from(emailLoginCodes)
      .where(eq(emailLoginCodes.email, EMAIL));
    expect(rows[0]?.attempts).toBe(1);
  });

  it("locks out after too many attempts, even with the right code", async () => {
    const db = getDb(env);
    const now = new Date("2026-06-22T10:00:00Z");
    const code = codeOf(await requestCode(db, EMAIL, now));
    const wrong = code === "000000" ? "111111" : "000000";

    for (let i = 0; i < OTP_MAX_ATTEMPTS; i++) {
      await verifyCode(db, EMAIL, wrong, now);
    }
    expect(await verifyCode(db, EMAIL, code, now)).toBe(false);
    expect(await db.select().from(emailLoginCodes)).toHaveLength(0);
  });

  it("rejects an expired code", async () => {
    const db = getDb(env);
    const now = new Date("2026-06-22T10:00:00Z");
    const code = codeOf(await requestCode(db, EMAIL, now));

    const later = new Date(now.getTime() + OTP_TTL_MS + 1);
    expect(await verifyCode(db, EMAIL, code, later)).toBe(false);
  });

  it("rejects when no code was ever requested", async () => {
    expect(await verifyCode(getDb(env), EMAIL, "123456", new Date())).toBe(
      false,
    );
  });
});

describe("purgeExpiredCodes", () => {
  it("deletes only expired rows", async () => {
    const db = getDb(env);
    const now = new Date("2026-06-22T10:00:00Z");
    await requestCode(db, "live@example.com", now);
    await db.insert(emailLoginCodes).values({
      email: "stale@example.com",
      codeHash: "x",
      expiresAt: new Date(now.getTime() - 1),
      attempts: 0,
      lastSentAt: new Date(now.getTime() - OTP_TTL_MS),
    });

    await purgeExpiredCodes(db, now);

    const rows = await db.select().from(emailLoginCodes);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.email).toBe("live@example.com");
  });
});
