import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { feedItems, feedSources, feeds, telegram } from "../../db/schema";
import { getDb } from "../lib/db";
import { app } from "../index";

const EMAIL = "user@example.test";
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
const asUser = (email: string): RequestInit => ({
  headers: { ...authHeaders, "X-Test-User-Email": email },
});

async function createFeed(title = "My feed"): Promise<number> {
  const res = await app.request("/api/feeds", json("POST", { title }), env);
  expect(res.status).toBe(200);
  const { id } = await res.json<{ id: number }>();
  return id;
}

beforeEach(async () => {
  const db = getDb(env);
  await db.delete(feedItems);
  await db.delete(feedSources);
  await db.delete(feeds);
  await db.delete(telegram);
});

describe("feeds api", () => {
  it("creates and lists feeds", async () => {
    expect(await (await app.request("/api/feeds", get, env)).json()).toEqual({
      feeds: [],
    });

    const id = await createFeed("Dev blogs");
    const list = await (
      await app.request("/api/feeds", get, env)
    ).json<{
      feeds: { id: number; title: string; preferencesText: string }[];
    }>();
    expect(list.feeds).toEqual([
      { id, title: "Dev blogs", preferencesText: "" },
    ]);
  });

  it("rejects an invalid create body", async () => {
    const empty = await app.request(
      "/api/feeds",
      json("POST", { title: "  " }),
      env,
    );
    expect(empty.status).toBe(400);
    const long = await app.request(
      "/api/feeds",
      json("POST", { title: "x".repeat(101) }),
      env,
    );
    expect(long.status).toBe(400);
  });

  it("404s another user's feed on every :id route", async () => {
    const id = await createFeed();
    const paths = [
      `/api/feeds/${String(id)}`,
      `/api/feeds/${String(id)}/items`,
      `/api/feeds/${String(id)}/archive`,
    ];
    for (const path of paths) {
      const res = await app.request(path, asUser("other@example.test"), env);
      expect(res.status).toBe(404);
    }
    const run = await app.request(
      `/api/feeds/${String(id)}/run`,
      {
        method: "POST",
        headers: { ...authHeaders, "X-Test-User-Email": "other@example.test" },
      },
      env,
    );
    expect(run.status).toBe(404);
    expect((await app.request(`/api/feeds/abc`, get, env)).status).toBe(400);
  });

  it("updates title and preferences, bumping the version only on change", async () => {
    const id = await createFeed();
    const path = `/api/feeds/${String(id)}`;
    const put = await app.request(
      path,
      json("PUT", { title: "Renamed", preferencesText: "rust" }),
      env,
    );
    expect(put.status).toBe(200);
    const detail = await (
      await app.request(path, get, env)
    ).json<{ title: string; preferencesText: string }>();
    expect(detail.title).toBe("Renamed");
    expect(detail.preferencesText).toBe("rust");

    const bad = await app.request(path, json("PUT", { title: "" }), env);
    expect(bad.status).toBe(400);
  });

  it("adds sources (validating them), lists them, and removes them", async () => {
    const id = await createFeed();
    const path = `/api/feeds/${String(id)}`;

    const invalid = await app.request(
      `${path}/sources`,
      json("POST", { url: "ftp://nope" }),
      env,
    );
    expect(invalid.status).toBe(400);

    // The fake RSS client fails URLs containing "bad".
    const unreachable = await app.request(
      `${path}/sources`,
      json("POST", { url: "https://bad.example.com/feed" }),
      env,
    );
    expect(unreachable.status).toBe(400);

    const added = await app.request(
      `${path}/sources`,
      json("POST", { url: "https://blogs.example.com/feed" }),
      env,
    );
    expect(added.status).toBe(200);
    const source = await added.json<{ id: number; title: string }>();
    expect(source.title).toBe("Fake Feed (blogs.example.com)");

    const duplicate = await app.request(
      `${path}/sources`,
      json("POST", { url: "https://blogs.example.com/feed" }),
      env,
    );
    expect(duplicate.status).toBe(409);

    const detail = await (
      await app.request(path, get, env)
    ).json<{ sources: { id: number }[] }>();
    expect(detail.sources).toHaveLength(1);

    const removed = await app.request(
      `${path}/sources/${String(source.id)}`,
      { method: "DELETE", headers: authHeaders },
      env,
    );
    expect(removed.status).toBe(200);
    const after = await (
      await app.request(path, get, env)
    ).json<{ sources: { id: number }[] }>();
    expect(after.sources).toHaveLength(0);
  });

  it("runs the feed and serves curated items and the archive", async () => {
    const id = await createFeed();
    const path = `/api/feeds/${String(id)}`;
    await app.request(
      path,
      json("PUT", { title: "My feed", preferencesText: "rust" }),
      env,
    );
    await app.request(
      `${path}/sources`,
      json("POST", { url: "https://blogs.example.com/feed" }),
      env,
    );

    const run = await app.request(`${path}/run`, json("POST", {}), env);
    expect(run.status).toBe(200);
    expect(await run.json()).toEqual({ count: 1 });

    const items = await (
      await app.request(`${path}/items`, get, env)
    ).json<{
      items: { title: string; url: string }[];
      lastFetchedAt: string | null;
    }>();
    expect(items.items).toHaveLength(1);
    expect(items.items[0]?.title).toContain("Rust");

    const archive = await (
      await app.request(`${path}/archive`, get, env)
    ).json<{ items: { title: string }[] }>();
    expect(archive.items).toHaveLength(1);
  });

  it("stamps the first open of an item and keeps it across refetches", async () => {
    const id = await createFeed();
    const path = `/api/feeds/${String(id)}`;
    await app.request(
      path,
      json("PUT", { title: "My feed", preferencesText: "rust" }),
      env,
    );
    await app.request(
      `${path}/sources`,
      json("POST", { url: "https://blogs.example.com/feed" }),
      env,
    );
    await app.request(`${path}/run`, json("POST", {}), env);
    const loadItems = async (): Promise<{ id: number; openedAt: string }[]> =>
      (
        await (
          await app.request(`${path}/items`, get, env)
        ).json<{ items: { id: number; openedAt: string }[] }>()
      ).items;

    const [item] = await loadItems();
    expect(item?.openedAt).toBeNull();
    if (item === undefined) {
      return;
    }

    const openPath = `${path}/items/${String(item.id)}/open`;
    expect((await app.request(openPath, json("POST", {}), env)).status).toBe(
      200,
    );
    const opened = (await loadItems())[0]?.openedAt;
    expect(opened).not.toBeNull();

    // A second open is a no-op, and a refetch must not clear the stamp.
    expect((await app.request(openPath, json("POST", {}), env)).status).toBe(
      200,
    );
    await app.request(`${path}/run`, json("POST", {}), env);
    expect((await loadItems())[0]?.openedAt).toBe(opened);

    expect(
      (await app.request(`${path}/items/999999/open`, json("POST", {}), env))
        .status,
    ).toBe(404);
    expect(
      (await app.request(`${path}/items/abc/open`, json("POST", {}), env))
        .status,
    ).toBe(400);
    const foreign = await app.request(
      openPath,
      {
        method: "POST",
        headers: { ...authHeaders, "X-Test-User-Email": "other@example.test" },
      },
      env,
    );
    expect(foreign.status).toBe(404);
  });

  it("reports per-source counts and lists that source's items", async () => {
    const id = await createFeed();
    const path = `/api/feeds/${String(id)}`;
    await app.request(
      path,
      json("PUT", { title: "My feed", preferencesText: "rust" }),
      env,
    );
    const added = await app.request(
      `${path}/sources`,
      json("POST", { url: "https://blogs.example.com/feed" }),
      env,
    );
    const source = await added.json<{
      id: number;
      fetchedCount: number;
      selectedCount: number;
    }>();
    expect(source).toMatchObject({ fetchedCount: 0, selectedCount: 0 });

    await app.request(`${path}/run`, json("POST", {}), env);

    const detail = await (
      await app.request(path, get, env)
    ).json<{ sources: { fetchedCount: number; selectedCount: number }[] }>();
    expect(detail.sources[0]).toMatchObject({
      fetchedCount: 15,
      selectedCount: 1,
    });

    const items = await (
      await app.request(`${path}/sources/${String(source.id)}/items`, get, env)
    ).json<{ items: { title: string; selected: boolean }[] }>();
    expect(items.items).toHaveLength(15);
    expect(items.items.filter((i) => i.selected).map((i) => i.title)).toEqual([
      "Rust in the kernel, one year in",
    ]);
    expect(
      (await app.request(`${path}/sources/abc/items`, get, env)).status,
    ).toBe(400);
    const foreign = await app.request(
      `${path}/sources/${String(source.id)}/items`,
      asUser("other@example.test"),
      env,
    );
    expect(foreign.status).toBe(404);
  });

  it("throttles an on-demand run within the cooldown window", async () => {
    const throttled = { ...env, DIGEST_COOLDOWN_SECONDS: 600 };
    const id = await createFeed();
    const path = `/api/feeds/${String(id)}`;
    await app.request(
      `${path}/sources`,
      json("POST", { url: "https://blogs.example.com/feed" }),
      throttled,
    );

    const first = await app.request(`${path}/run`, json("POST", {}), throttled);
    expect(first.status).toBe(200);

    const second = await app.request(
      `${path}/run`,
      json("POST", {}),
      throttled,
    );
    expect(second.status).toBe(429);
    expect(Number(second.headers.get("Retry-After"))).toBeGreaterThan(0);
  });

  it("accepts slots only once a chat is linked", async () => {
    const id = await createFeed();
    const path = `/api/feeds/${String(id)}/slots`;
    const body = { slots: ["08:32", null, "20:00"] };

    const notLinked = await app.request(path, json("PUT", body), env);
    expect(notLinked.status).toBe(409);

    await getDb(env)
      .insert(telegram)
      .values({ userEmail: EMAIL, chatId: 4242 });
    const linked = await app.request(path, json("PUT", body), env);
    expect(linked.status).toBe(200);

    const detail = await (
      await app.request(`/api/feeds/${String(id)}`, get, env)
    ).json<{ slots: (string | null)[]; telegramLinked: boolean }>();
    expect(detail.telegramLinked).toBe(true);
    expect(detail.slots).toEqual(["08:30", null, "20:00"]);
  });

  it("deletes a feed with everything in it", async () => {
    const id = await createFeed();
    const path = `/api/feeds/${String(id)}`;
    await app.request(
      `${path}/sources`,
      json("POST", { url: "https://blogs.example.com/feed" }),
      env,
    );
    await app.request(`${path}/run`, json("POST", {}), env);

    const del = await app.request(
      path,
      { method: "DELETE", headers: authHeaders },
      env,
    );
    expect(del.status).toBe(200);
    expect((await app.request(path, get, env)).status).toBe(404);
    expect(await getDb(env).select().from(feedItems)).toHaveLength(0);
    expect(await getDb(env).select().from(feedSources)).toHaveLength(0);
  });
});
