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

  it("marks worker responses uncacheable", async () => {
    const res = await app.request("/api/health", get, env);
    expect(res.headers.get("Cache-Control")).toBe("private, no-store");
  });

  it("starts with an empty feed", async () => {
    const res = await app.request("/api/stories", get, env);
    expect(await res.json()).toEqual({ stories: [] });
  });

  it("rejects a state-changing request from a cross-site Origin", async () => {
    const res = await app.request(
      "/api/preferences",
      {
        method: "PUT",
        headers: {
          ...authHeaders,
          "Content-Type": "application/json",
          Origin: "https://evil.example",
        },
        body: JSON.stringify({ text: "rust" }),
      },
      env,
    );
    expect(res.status).toBe(403);
  });

  it("allows a state-changing request from the same Origin", async () => {
    const res = await app.request(
      "/api/preferences",
      {
        method: "PUT",
        headers: {
          ...authHeaders,
          "Content-Type": "application/json",
          Origin: "http://localhost",
        },
        body: JSON.stringify({ text: "rust" }),
      },
      env,
    );
    expect(res.status).toBe(200);
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
    ).json<{
      linked: boolean;
      chatLabel: string | null;
      slots: (string | null)[];
      timezone: string | null;
    }>();
    expect(before).toEqual({
      linked: false,
      chatLabel: null,
      slots: [null, null, null],
      timezone: null,
    });

    const minted = await (
      await app.request(
        "/api/telegram/link-code",
        json("POST", { timezone: "America/New_York" }),
        env,
      )
    ).json<{ code: string; url: string | null; expiresAt: string }>();
    expect(minted.code).toMatch(/^[0-9a-f]{16}$/);
    expect(minted.url).toBeNull();

    const stored = await getDb(env)
      .select()
      .from(telegram)
      .where(eq(telegram.userEmail, EMAIL));
    expect(stored[0]?.linkCode).toBe(minted.code);
    expect(stored[0]?.timezone).toBe("America/New_York");
  });

  it("rejects a link code with an invalid timezone", async () => {
    const res = await app.request(
      "/api/telegram/link-code",
      json("POST", { timezone: "Mars/Olympus" }),
      env,
    );
    expect(res.status).toBe(400);
  });

  it("sets the timezone and reports it in status", async () => {
    const put = await app.request(
      "/api/telegram/timezone",
      json("PUT", { timezone: "Asia/Tokyo" }),
      env,
    );
    expect(put.status).toBe(200);

    const status = await (
      await app.request("/api/telegram", get, env)
    ).json<{ timezone: string | null }>();
    expect(status.timezone).toBe("Asia/Tokyo");

    const bad = await app.request(
      "/api/telegram/timezone",
      json("PUT", { timezone: "not-a-zone" }),
      env,
    );
    expect(bad.status).toBe(400);
  });

  it("links a chat through the webhook with the right secret", async () => {
    const minted = await (
      await app.request(
        "/api/telegram/link-code",
        json("POST", { timezone: "America/New_York" }),
        env,
      )
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
      message: {
        chat: { id: 777, username: "just" },
        text: `/start ${minted.code}`,
      },
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
    ).json<{ linked: boolean; chatLabel: string | null }>();
    expect(status.linked).toBe(true);
    expect(status.chatLabel).toBe("@just");
  });

  it("sets daily-summary slots only once a chat is linked", async () => {
    const notLinked = await app.request(
      "/api/telegram/slots",
      json("PUT", { slots: ["08:00", null, null] }),
      env,
    );
    expect(notLinked.status).toBe(409);

    const minted = await (
      await app.request(
        "/api/telegram/link-code",
        json("POST", { timezone: "America/New_York" }),
        env,
      )
    ).json<{ code: string }>();
    await app.request(
      "/telegram/webhook",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Telegram-Bot-Api-Secret-Token": "unit-webhook-secret",
        },
        body: JSON.stringify({
          message: { chat: { id: 555 }, text: `/start ${minted.code}` },
        }),
      },
      env,
    );

    const bad = await app.request(
      "/api/telegram/slots",
      json("PUT", { slots: ["nope", null, null] }),
      env,
    );
    expect(bad.status).toBe(400);

    const ok = await app.request(
      "/api/telegram/slots",
      json("PUT", { slots: ["08:32", null, "20:00"] }),
      env,
    );
    expect(ok.status).toBe(200);

    const status = await (
      await app.request("/api/telegram", get, env)
    ).json<{ slots: (string | null)[] }>();
    expect(status.slots).toEqual(["08:30", null, "20:00"]);
  });

  it("rejects a test message until a chat is linked", async () => {
    const notLinked = await app.request(
      "/api/telegram/test",
      json("POST", {}),
      env,
    );
    expect(notLinked.status).toBe(409);

    const minted = await (
      await app.request(
        "/api/telegram/link-code",
        json("POST", { timezone: "America/New_York" }),
        env,
      )
    ).json<{ code: string }>();
    const linkUpdate = {
      message: { chat: { id: 888 }, text: `/start ${minted.code}` },
    };
    await app.request(
      "/telegram/webhook",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Telegram-Bot-Api-Secret-Token": "unit-webhook-secret",
        },
        body: JSON.stringify(linkUpdate),
      },
      env,
    );

    const sent = await app.request("/api/telegram/test", json("POST", {}), env);
    expect(sent.status).toBe(200);
  });

  it("disconnects a linked chat via DELETE /api/telegram", async () => {
    const minted = await (
      await app.request(
        "/api/telegram/link-code",
        json("POST", { timezone: "America/New_York" }),
        env,
      )
    ).json<{ code: string }>();
    await app.request(
      "/telegram/webhook",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Telegram-Bot-Api-Secret-Token": "unit-webhook-secret",
        },
        body: JSON.stringify({
          message: { chat: { id: 909 }, text: `/start ${minted.code}` },
        }),
      },
      env,
    );
    expect(
      (
        await (
          await app.request("/api/telegram", get, env)
        ).json<{
          linked: boolean;
        }>()
      ).linked,
    ).toBe(true);

    const del = await app.request(
      "/api/telegram",
      { method: "DELETE", headers: authHeaders },
      env,
    );
    expect(del.status).toBe(200);

    const after = await (
      await app.request("/api/telegram", get, env)
    ).json<{ linked: boolean; slots: (string | null)[] }>();
    expect(after.linked).toBe(false);
    expect(after.slots).toEqual([null, null, null]);
  });

  it("re-curates against new preferences after an edit", async () => {
    interface Feed {
      stories: { title: string }[];
    }
    const titles = async (): Promise<string[]> => {
      const body = await (
        await app.request("/api/stories", get, env)
      ).json<Feed>();
      return body.stories.map((s) => s.title.toLowerCase());
    };

    await app.request("/api/preferences", json("PUT", { text: "rust" }), env);
    await app.request("/api/digest/run", json("POST", {}), env);
    expect((await titles()).some((t) => t.includes("rust"))).toBe(true);
    expect((await titles()).some((t) => t.includes("bitcoin"))).toBe(false);

    // Editing the preferences bumps the version, so the next run re-evaluates the
    // front page against the new text instead of reusing the old verdicts.
    await app.request(
      "/api/preferences",
      json("PUT", { text: "bitcoin" }),
      env,
    );
    await app.request("/api/digest/run", json("POST", {}), env);
    expect((await titles()).some((t) => t.includes("bitcoin"))).toBe(true);
    expect((await titles()).some((t) => t.includes("rust"))).toBe(false);
  });
});
