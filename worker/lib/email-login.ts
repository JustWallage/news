import { eq, lte, sql } from "drizzle-orm";
import { emailLoginCodes } from "../../db/schema";
import { sha256Hex, timingSafeEqual } from "./crypto";
import type { Db } from "./db";

// One-time email sign-in codes. Pure D1 logic with no environment branching
// (mirrors rate-limit.ts); the route owns the Turnstile gate, email send, and
// session minting. Codes are stored only as a salted hash, never in clear.
const OTP_LENGTH = 6;
export const OTP_TTL_MS = 10 * 60 * 1000;
export const OTP_MAX_ATTEMPTS = 5;
export const OTP_RESEND_COOLDOWN_MS = 60 * 1000;

// Trim + lowercase so `User@x.com` and `user@x.com` resolve to one account, and
// so request and verify always hit the same row.
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

// A uniform 6-digit code. Rejection-sampled per digit (bytes 250-255 dropped) so
// there is no modulo bias toward the low digits.
export function generateOtp(): string {
  let out = "";
  while (out.length < OTP_LENGTH) {
    const [byte] = crypto.getRandomValues(new Uint8Array(1));
    if (byte !== undefined && byte < 250) {
      out += (byte % 10).toString();
    }
  }
  return out;
}

function hashCode(email: string, code: string): Promise<string> {
  return sha256Hex(`${email}:${code}`);
}

export type RequestCodeResult = { code: string } | { retryAfterMs: number };

// Issue a code for `email` (already normalized), or throttle if the previous code
// is still inside the resend cooldown. A successful issue upserts the row, resets
// the attempt counter, and stamps a fresh expiry + send time.
export async function requestCode(
  db: Db,
  email: string,
  now: Date,
): Promise<RequestCodeResult> {
  const rows = await db
    .select()
    .from(emailLoginCodes)
    .where(eq(emailLoginCodes.email, email))
    .limit(1);
  const existing = rows[0];
  if (
    existing !== undefined &&
    existing.expiresAt.getTime() > now.getTime() &&
    now.getTime() - existing.lastSentAt.getTime() < OTP_RESEND_COOLDOWN_MS
  ) {
    return {
      retryAfterMs:
        OTP_RESEND_COOLDOWN_MS -
        (now.getTime() - existing.lastSentAt.getTime()),
    };
  }
  const code = generateOtp();
  const row = {
    email,
    codeHash: await hashCode(email, code),
    expiresAt: new Date(now.getTime() + OTP_TTL_MS),
    attempts: 0,
    lastSentAt: now,
  };
  await db
    .insert(emailLoginCodes)
    .values(row)
    .onConflictDoUpdate({
      target: emailLoginCodes.email,
      set: {
        codeHash: row.codeHash,
        expiresAt: row.expiresAt,
        attempts: 0,
        lastSentAt: row.lastSentAt,
      },
    });
  return { code };
}

// Validate a submitted code for `email` (already normalized). A correct code is
// single-use: it deletes the row. A wrong code increments the attempt counter,
// and once the cap is hit the row is dropped (forcing a re-request) so a stolen
// code can never be brute-forced within its 10-minute window.
export async function verifyCode(
  db: Db,
  email: string,
  code: string,
  now: Date,
): Promise<boolean> {
  const rows = await db
    .select()
    .from(emailLoginCodes)
    .where(eq(emailLoginCodes.email, email))
    .limit(1);
  const row = rows[0];
  if (row === undefined || row.expiresAt.getTime() <= now.getTime()) {
    return false;
  }
  if (row.attempts >= OTP_MAX_ATTEMPTS) {
    await db.delete(emailLoginCodes).where(eq(emailLoginCodes.email, email));
    return false;
  }
  const matches = await timingSafeEqual(
    await hashCode(email, code),
    row.codeHash,
  );
  if (!matches) {
    await db
      .update(emailLoginCodes)
      .set({ attempts: sql`${emailLoginCodes.attempts} + 1` })
      .where(eq(emailLoginCodes.email, email));
    return false;
  }
  await db.delete(emailLoginCodes).where(eq(emailLoginCodes.email, email));
  return true;
}

// Drop codes past their expiry. Already ignored at verify time; this just bounds
// table growth (called from the nightly maintenance purge).
export async function purgeExpiredCodes(db: Db, now: Date): Promise<void> {
  await db.delete(emailLoginCodes).where(lte(emailLoginCodes.expiresAt, now));
}
