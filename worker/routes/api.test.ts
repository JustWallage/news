import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { curations, preferences, stories } from "../../db/schema";
import { getDb } from "../lib/db";
import { app } from "../index";

// The test pool runs in the e2e env (ENVIRONMENT=e2e, no AI binding), so identity
// comes from the test headers and createDeps wires the deterministic fakes — the
// digest pipeline runs hermetically (canned data + keyword filter).
const EMAIL = "just@wallage.nl";
const authHeaders = {
  "X-Test-User-Email": EMAIL,
  "X-Test-Auth": "unit-test-token",
};
const get: RequestInit = { headers: authHeaders };
const json = (method: string, body: unknown): RequestInit => ({
  method,
  headers: { ...authHeaders, "Content-Type": "application/json" },
  body: JSON.stringify(body),
});

beforeEach(async () => {
  const db = getDb(env);
  await db.delete(curations);
  await db.delete(stories);
  await db.delete(preferences);
});

describe("api", () => {
  it("reports the signed-in identity", async () => {
    const res = await app.request("/api/health", get, env);
    expect(await res.json()).toEqual({ ok: true, email: EMAIL });
  });

  it("starts with an empty feed", async () => {
    const res = await app.request("/api/stories", get, env);
    expect(await res.json()).toEqual({ stories: [] });
  });

  it("round-trips preferences", async () => {
    const put = await app.request(
      "/api/preferences",
      json("PUT", { text: "rust and self-hosting" }),
      env,
    );
    expect(put.status).toBe(200);
    const body = await (
      await app.request("/api/preferences", get, env)
    ).json<{ text: string; updatedAt: string | null }>();
    expect(body.text).toBe("rust and self-hosting");
    expect(body.updatedAt).not.toBeNull();
  });

  it("curates the feed from preferences and records opens", async () => {
    await app.request("/api/preferences", json("PUT", { text: "rust" }), env);
    const run = await app.request("/api/digest/run", json("POST", {}), env);
    const { count } = await run.json<{ count: number }>();
    expect(count).toBe(1);

    const feed = await app.request("/api/stories", get, env);
    const { stories } = await feed.json<{
      stories: { id: number; title: string; openedAt: string | null }[];
    }>();
    expect(stories).toHaveLength(1);
    expect(stories[0]?.title.toLowerCase()).toContain("rust");
    expect(stories[0]?.openedAt).toBeNull();

    const id = stories[0]?.id ?? 0;
    const open = await app.request(
      `/api/stories/${id}/open`,
      json("POST", {}),
      env,
    );
    expect(open.status).toBe(200);

    const after = await (
      await app.request("/api/stories", get, env)
    ).json<{
      stories: { openedAt: string | null }[];
    }>();
    expect(after.stories[0]?.openedAt).not.toBeNull();
  });
});
