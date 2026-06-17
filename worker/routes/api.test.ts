import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { curations, preferences, stories } from "../../db/schema";
import { getDb } from "../lib/db";
import { app } from "../index";

// ENVIRONMENT=local → root DI wires the fake HN + AI deps (canned data,
// keyword filter), so /api/digest/run runs the real pipeline hermetically.
const LOCAL = {
  ...env,
  ENVIRONMENT: "local",
  DEV_USER_EMAIL: "just@wallage.nl",
};

const json = (method: string, body: unknown): RequestInit => ({
  method,
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body),
});

// One D1 per test file; reset the shared tables between tests.
beforeEach(async () => {
  const db = getDb(env);
  await db.delete(curations);
  await db.delete(stories);
  await db.delete(preferences);
});

describe("api", () => {
  it("reports the signed-in identity", async () => {
    const res = await app.request("/api/health", {}, LOCAL);
    expect(await res.json()).toEqual({ ok: true, email: "just@wallage.nl" });
  });

  it("starts with an empty feed", async () => {
    const res = await app.request("/api/stories", {}, LOCAL);
    expect(await res.json()).toEqual({ stories: [] });
  });

  it("round-trips preferences", async () => {
    const put = await app.request(
      "/api/preferences",
      json("PUT", { text: "rust and self-hosting" }),
      LOCAL,
    );
    expect(put.status).toBe(200);
    const body = await (
      await app.request("/api/preferences", {}, LOCAL)
    ).json<{
      text: string;
      updatedAt: string | null;
    }>();
    expect(body.text).toBe("rust and self-hosting");
    expect(body.updatedAt).not.toBeNull();
  });

  it("curates the feed from preferences and records opens", async () => {
    await app.request("/api/preferences", json("PUT", { text: "rust" }), LOCAL);
    const run = await app.request("/api/digest/run", { method: "POST" }, LOCAL);
    const { count } = await run.json<{ count: number }>();
    expect(count).toBe(1);

    const feed = await app.request("/api/stories", {}, LOCAL);
    const { stories } = await feed.json<{
      stories: { id: number; title: string; openedAt: string | null }[];
    }>();
    expect(stories).toHaveLength(1);
    expect(stories[0]?.title.toLowerCase()).toContain("rust");
    expect(stories[0]?.openedAt).toBeNull();

    const id = stories[0]?.id ?? 0;
    const open = await app.request(
      `/api/stories/${id}/open`,
      { method: "POST" },
      LOCAL,
    );
    expect(open.status).toBe(200);

    const after = await (
      await app.request("/api/stories", {}, LOCAL)
    ).json<{
      stories: { openedAt: string | null }[];
    }>();
    expect(after.stories[0]?.openedAt).not.toBeNull();
  });
});
