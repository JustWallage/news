import { eq } from "drizzle-orm";
import { sessions } from "../../db/schema";
import { sha256Hex } from "./crypto";
import type { Db } from "./db";

export const SESSION_COOKIE = "session";
export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

function generateToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
}

// Mint a session: store only the token's hash, hand the raw token back to be set
// as the cookie value.
export async function createSession(
  db: Db,
  userEmail: string,
  now: Date,
): Promise<{ token: string; expiresAt: Date }> {
  const token = generateToken();
  const expiresAt = new Date(now.getTime() + SESSION_TTL_MS);
  await db
    .insert(sessions)
    .values({ id: await sha256Hex(token), userEmail, expiresAt });
  return { token, expiresAt };
}

// Resolve a cookie token to its user, or null when unknown or expired.
export async function lookupSession(
  db: Db,
  token: string,
  now: Date,
): Promise<string | null> {
  const rows = await db
    .select()
    .from(sessions)
    .where(eq(sessions.id, await sha256Hex(token)))
    .limit(1);
  const row = rows[0];
  if (row === undefined || row.expiresAt.getTime() <= now.getTime()) {
    return null;
  }
  return row.userEmail;
}

export async function deleteSession(db: Db, token: string): Promise<void> {
  await db.delete(sessions).where(eq(sessions.id, await sha256Hex(token)));
}
