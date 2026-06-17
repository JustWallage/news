import { env } from "cloudflare:workers";
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { curations, preferences, stories, telegram } from "../../db/schema";
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
  await db.delete(telegram);
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

  it("reports Telegram status and mints a link code", async () => {
    const before = await (
      await app.request("/api/telegram", get, env)
    ).json<{ linked: boolean; slots: (string | null)[] }>();
    expect(before).toEqual({ linked: false, slots: [null, null, null] });

    const minted = await (
      await app.request("/api/telegram/link-code", json("POST", {}), env)
    ).json<{ code: string; url: string | null; expiresAt: string }>();
    expect(minted.code).toMatch(/^[0-9a-f]{8}$/);
    expect(minted.url).toBeNull();

    const stored = await getDb(env)
      .select()
      .from(telegram)
      .where(eq(telegram.userEmail, EMAIL));
    expect(stored[0]?.linkCode).toBe(minted.code);
  });

  it("links a chat through the webhook with the right secret", async () => {
    const minted = await (
      await app.request("/api/telegram/link-code", json("POST", {}), env)
    ).json<{ code: string }>();

    const webhook = (secret: string | null, body: unknown): RequestInit => ({
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(secret === null
          ? {}
          : { "X-Telegram-Bot-Api-Secret-Token": secret }),
      },
      body: JSON.stringify(body),
    });
    const update = {
      message: { chat: { id: 777 }, text: `/start ${minted.code}` },
    };

    const wrong = await app.request(
      "/telegram/webhook",
      webhook("wrong", update),
      env,
    );
    expect(wrong.status).toBe(403);

    const missing = await app.request(
      "/telegram/webhook",
      webhook(null, update),
      env,
    );
    expect(missing.status).toBe(403);

    const ok = await app.request(
      "/telegram/webhook",
      webhook("unit-webhook-secret", update),
      env,
    );
    expect(ok.status).toBe(200);

    const status = await (
      await app.request("/api/telegram", get, env)
    ).json<{ linked: boolean }>();
    expect(status.linked).toBe(true);
  });
});
