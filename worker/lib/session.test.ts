import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { sessions } from "../../db/schema";
import { getDb } from "./db";
import {
  createSession,
  deleteSession,
  lookupSession,
  SESSION_TTL_MS,
} from "./session";

const USER = "just@wallage.nl";

beforeEach(async () => {
  await getDb(env).delete(sessions);
});

describe("sessions", () => {
  it("stores only the token hash and resolves it back to the user", async () => {
    const db = getDb(env);
    const now = new Date("2026-06-22T10:00:00Z");
    const { token } = await createSession(db, USER, now);

    const rows = await db.select().from(sessions);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.id).not.toBe(token);

    expect(await lookupSession(db, token, now)).toBe(USER);
  });

  it("returns null for an unknown token", async () => {
    expect(await lookupSession(getDb(env), "nope", new Date())).toBeNull();
  });

  it("returns null once the session has expired", async () => {
    const db = getDb(env);
    const now = new Date("2026-06-22T10:00:00Z");
    const { token } = await createSession(db, USER, now);
    const later = new Date(now.getTime() + SESSION_TTL_MS + 1);
    expect(await lookupSession(db, token, later)).toBeNull();
  });

  it("deletes the session", async () => {
    const db = getDb(env);
    const now = new Date();
    const { token } = await createSession(db, USER, now);
    await deleteSession(db, token);
    expect(await lookupSession(db, token, now)).toBeNull();
  });
});
