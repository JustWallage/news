import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { digestRuns } from "../../db/schema";
import { getDb } from "./db";
import { digestCooldownRemainingMs, recordDigestRun } from "./rate-limit";

const USER = "user@example.test";
const COOLDOWN = 10 * 60 * 1000;

beforeEach(async () => {
  await getDb(env).delete(digestRuns);
});

describe("digest rate limit", () => {
  it("allows the first run and blocks a second within the window", async () => {
    const db = getDb(env);
    const now = new Date("2026-06-22T10:00:00Z");

    expect(await digestCooldownRemainingMs(db, USER, COOLDOWN, now)).toBe(0);
    await recordDigestRun(db, USER, now);

    const soon = new Date(now.getTime() + 60 * 1000);
    const remaining = await digestCooldownRemainingMs(db, USER, COOLDOWN, soon);
    expect(remaining).toBe(COOLDOWN - 60 * 1000);
  });

  it("allows another run once the window has elapsed", async () => {
    const db = getDb(env);
    const now = new Date("2026-06-22T10:00:00Z");
    await recordDigestRun(db, USER, now);

    const later = new Date(now.getTime() + COOLDOWN + 1);
    expect(await digestCooldownRemainingMs(db, USER, COOLDOWN, later)).toBe(0);
  });

  it("never rate-limits when the cooldown is disabled (0)", async () => {
    const db = getDb(env);
    const now = new Date("2026-06-22T10:00:00Z");
    await recordDigestRun(db, USER, now);
    expect(await digestCooldownRemainingMs(db, USER, 0, now)).toBe(0);
  });

  it("re-records (upserts) the latest run time", async () => {
    const db = getDb(env);
    const first = new Date("2026-06-22T10:00:00Z");
    const second = new Date("2026-06-22T10:30:00Z");
    await recordDigestRun(db, USER, first);
    await recordDigestRun(db, USER, second);

    const rows = await db.select().from(digestRuns);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.lastRunAt.getTime()).toBe(second.getTime());
  });
});
