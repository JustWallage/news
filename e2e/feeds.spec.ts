import type { APIRequestContext } from "@playwright/test";
import {
  feedCreatedSchema,
  feedDetailSchema,
  feedItemListSchema,
  telegramLinkCodeSchema,
} from "@shared/api";
import { expect, test } from "./fixtures";

const WEBHOOK_SECRET = process.env.E2E_WEBHOOK_SECRET ?? "e2e-webhook-secret";

// API-side setup so UI tests can start from a feed that already has content:
// create a feed, optionally set preferences and add a (fake) RSS source.
async function seedFeed(
  request: APIRequestContext,
  opts: { title: string; preferences?: string; sourceHost?: string },
): Promise<number> {
  const created = feedCreatedSchema.parse(
    await (
      await request.post("/api/feeds", { data: { title: opts.title } })
    ).json(),
  );
  if (opts.preferences !== undefined) {
    const updated = await request.put(`/api/feeds/${String(created.id)}`, {
      data: { title: opts.title, preferencesText: opts.preferences },
    });
    expect(updated.ok()).toBe(true);
  }
  if (opts.sourceHost !== undefined) {
    const added = await request.post(
      `/api/feeds/${String(created.id)}/sources`,
      { data: { url: `https://${opts.sourceHost}/feed` } },
    );
    expect(added.ok()).toBe(true);
  }
  return created.id;
}

async function linkChat(request: APIRequestContext): Promise<void> {
  const minted = telegramLinkCodeSchema.parse(
    await (
      await request.post("/api/telegram/link-code", {
        data: { timezone: "America/New_York" },
      })
    ).json(),
  );
  const linked = await request.post("/telegram/webhook", {
    headers: { "X-Telegram-Bot-Api-Secret-Token": WEBHOOK_SECRET },
    data: {
      message: {
        chat: { id: Math.floor(Math.random() * 1_000_000_000) },
        text: `/start ${minted.code}`,
      },
    },
  });
  expect(linked.status()).toBe(200);
}

test("creates a feed from the overview and lands on its settings", async ({
  page,
}) => {
  await page.goto("/feeds");
  await expect(page.getByText("No feeds yet")).toBeVisible();

  await page.getByLabel("Feed title").fill("Dev blogs");
  await page.getByRole("button", { name: "Create feed" }).click();

  await expect(page).toHaveURL(/\/feeds\/\d+\/settings$/);
  await expect(page.getByLabel("Title")).toHaveValue("Dev blogs");
});

test("adds a source and preferences, then Refresh shows only matching items", async ({
  page,
  request,
}) => {
  const id = await seedFeed(request, { title: "Rusty" });
  await page.goto(`/feeds/${String(id)}/settings`);

  await page.getByLabel("Source URL").fill("https://blogs.example.com/feed");
  await page.getByRole("button", { name: "Add source" }).click();
  await expect(page.getByText("Fake Feed (blogs.example.com)")).toBeVisible();

  await page.getByLabel("Preferences").fill("rust");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByText("Saved.").first()).toBeVisible();

  await page.getByRole("link", { name: "← Back to feed" }).click();
  // The header also has a Refresh (the HN feed's) — target the feed page's own.
  await page.getByRole("main").getByRole("button", { name: "Refresh" }).click();

  await expect(page.getByText("Rust in the kernel, one year in")).toBeVisible();
  await expect(page.getByText("Bitcoin custody for grandmothers")).toBeHidden();
  await expect(page.getByText("Sample article 0")).toBeHidden();
});

test("the overview shows a card with the title and preferences entry", async ({
  page,
  request,
}) => {
  await seedFeed(request, { title: "Crypto watch", preferences: "bitcoin" });
  await page.goto("/feeds");

  const card = page.getByRole("link", { name: /Crypto watch/ });
  await expect(card).toBeVisible();
  await expect(card.getByText("bitcoin")).toBeVisible();
});

test("switching feeds goes through the overview, which is the only affordance", async ({
  page,
  request,
}) => {
  const first = await seedFeed(request, { title: "First feed" });
  await seedFeed(request, { title: "Second feed" });

  await page.goto(`/feeds/${String(first)}`);
  await expect(page.getByLabel("Selected feed")).toBeHidden();
  await expect(page.getByRole("link", { name: "New feed" })).toBeHidden();

  await page.getByRole("link", { name: "← All feeds" }).click();
  await expect(page).toHaveURL("/feeds");
  await expect(page.getByText("First feed")).toBeVisible();

  await page.getByRole("link", { name: /Second feed/ }).click();
  await expect(page).toHaveURL(/\/feeds\/\d+$/);
  await expect(page).not.toHaveURL(`/feeds/${String(first)}`);
});

test("the archive links back to its feed", async ({ page, request }) => {
  const id = await seedFeed(request, { title: "Navigable" });
  await page.goto(`/feeds/${String(id)}/archive`);

  await page.getByRole("link", { name: "← Back to feed" }).click();

  await expect(page).toHaveURL(`/feeds/${String(id)}`);
});

test("a failing source URL surfaces an error and stores nothing", async ({
  page,
  request,
}) => {
  const id = await seedFeed(request, { title: "Broken" });
  await page.goto(`/feeds/${String(id)}/settings`);

  await page.getByLabel("Source URL").fill("https://bad.example.com/feed");
  await page.getByRole("button", { name: "Add source" }).click();

  await expect(page.getByText("Could not reach that URL")).toBeVisible();
  await expect(page.getByText("No sources yet.")).toBeVisible();
});

test("removing a source is confirmed first, and cancelling keeps it", async ({
  page,
  request,
}) => {
  const id = await seedFeed(request, {
    title: "Second thoughts",
    sourceHost: "blogs.example.com",
  });
  await page.goto(`/feeds/${String(id)}/settings`);

  const card = page.getByRole("button", {
    name: "Items from Fake Feed (blogs.example.com)",
  });
  const removeButton = page.getByRole("button", {
    name: "Remove Fake Feed (blogs.example.com)",
  });
  await expect(card).toBeVisible();

  await removeButton.click();
  await page.getByRole("button", { name: "Cancel" }).click();
  await expect(card).toBeVisible();

  await removeButton.click();
  await page.getByRole("button", { name: "Yes, remove" }).click();

  await expect(page.getByText("No sources yet.")).toBeVisible();
});

test("telegram slots are offered only once a chat is linked", async ({
  page,
  request,
}) => {
  const id = await seedFeed(request, { title: "Slotted" });
  await page.goto(`/feeds/${String(id)}/settings`);
  await expect(page.getByText(/Connect Telegram/)).toBeVisible();
  await expect(page.getByLabel("First daily summary time")).toBeHidden();

  await linkChat(request);
  await page.reload();

  await page.getByLabel("First daily summary time").fill("08:30");
  await page.getByRole("button", { name: "Save times" }).click();
  await expect(page.getByText("Saved.")).toBeVisible();

  await page.reload();
  // getByLabel would also match the "Clear …" button once the slot is set.
  await expect(
    page.getByRole("textbox", { name: "First daily summary time" }),
  ).toHaveValue("08:30");
});

test("the archive keeps items that fell out of the current fetch", async ({
  page,
  request,
}) => {
  const id = await seedFeed(request, {
    title: "Archival",
    preferences: "rust bitcoin",
    sourceHost: "one.example.com",
  });
  const firstRun = await request.post(`/api/feeds/${String(id)}/run`);
  expect(firstRun.ok()).toBe(true);

  // Swap the source for one on a different host (different item links): the
  // first fetch's items drop out of the current feed but stay in the archive.
  const detail = feedDetailSchema.parse(
    await (await request.get(`/api/feeds/${String(id)}`)).json(),
  );
  const oldSource = detail.sources[0];
  expect(oldSource).toBeDefined();
  if (oldSource === undefined) {
    return;
  }
  await request.delete(
    `/api/feeds/${String(id)}/sources/${String(oldSource.id)}`,
  );
  const added = await request.post(`/api/feeds/${String(id)}/sources`, {
    data: { url: "https://two.example.com/feed" },
  });
  expect(added.ok()).toBe(true);
  const secondRun = await request.post(`/api/feeds/${String(id)}/run`);
  expect(secondRun.ok()).toBe(true);

  const rustTitle = "Rust in the kernel, one year in";
  await page.goto(`/feeds/${String(id)}`);
  await expect(page.getByText(rustTitle)).toHaveCount(1);

  await page.goto(`/feeds/${String(id)}/archive`);
  await expect(page.getByText(rustTitle)).toHaveCount(2);
  await expect(page.getByText("Bitcoin custody for grandmothers")).toHaveCount(
    2,
  );
  await expect(page.getByText("Sample article 0")).toBeHidden();
});

test("each source card shows its counts and opens the fetched/selected lists", async ({
  page,
  request,
}) => {
  const id = await seedFeed(request, {
    title: "Counted",
    preferences: "rust",
    sourceHost: "blogs.example.com",
  });
  expect((await request.post(`/api/feeds/${String(id)}/run`)).ok()).toBe(true);

  await page.goto(`/feeds/${String(id)}/settings`);
  await expect(page.getByText("15 fetched · 1 selected")).toBeVisible();

  await page
    .getByRole("button", { name: "Items from Fake Feed (blogs.example.com)" })
    .click();

  const dialog = page.getByRole("dialog");
  await expect(dialog.getByText("Selected (1)")).toBeVisible();
  await expect(dialog.getByText("Fetched (15)")).toBeVisible();
  await expect(dialog.getByText("Rust in the kernel, one year in")).toHaveCount(
    2,
  );
  await expect(dialog.getByText("Sample article 0")).toHaveCount(1);
});

test("an opened item greys out on the feed and stays grey in the archive", async ({
  page,
  request,
}) => {
  const id = await seedFeed(request, {
    title: "Readable",
    preferences: "rust",
    sourceHost: "blogs.example.com",
  });
  expect((await request.post(`/api/feeds/${String(id)}/run`)).ok()).toBe(true);

  const title = "Rust in the kernel, one year in";
  await page.goto(`/feeds/${String(id)}`);
  const link = page.getByRole("link", { name: title });
  await expect(link).not.toHaveClass(/text-muted-foreground/);

  const open = page.waitForResponse(
    (r) => r.url().includes("/open") && r.request().method() === "POST",
  );
  await link.click();
  await open;
  await expect(link).toHaveClass(/text-muted-foreground/);

  await page.goto(`/feeds/${String(id)}/archive`);
  await expect(page.getByRole("link", { name: title })).toHaveClass(
    /text-muted-foreground/,
  );
});

test("an item is picked on its summary alone, and a summary-less source still works", async ({
  page,
  request,
}) => {
  // "Amsterdam" appears only in the canned summary, never in a title.
  const bySummary = await seedFeed(request, {
    title: "By summary",
    preferences: "amsterdam",
    sourceHost: "blogs.example.com",
  });
  expect((await request.post(`/api/feeds/${String(bySummary)}/run`)).ok()).toBe(
    true,
  );
  await page.goto(`/feeds/${String(bySummary)}`);
  await expect(page.getByText("A quiet year for the platform")).toBeVisible();

  // The "plain" host serves items with no summary at all: still fetched, still judged.
  const plain = await seedFeed(request, {
    title: "Plain",
    preferences: "rust",
    sourceHost: "plain.example.com",
  });
  expect((await request.post(`/api/feeds/${String(plain)}/run`)).ok()).toBe(
    true,
  );
  await page.goto(`/feeds/${String(plain)}`);
  await expect(page.getByText("Rust in the kernel, one year in")).toBeVisible();
  await expect(page.getByText("A quiet year for the platform")).toBeHidden();
});

test("re-fetching an unchanged source re-judges nothing", async ({
  request,
}) => {
  const id = await seedFeed(request, {
    title: "Stable",
    preferences: "rust",
    sourceHost: "blogs.example.com",
  });
  const path = `/api/feeds/${String(id)}`;
  expect((await request.post(`${path}/run`)).ok()).toBe(true);
  const first = feedItemListSchema.parse(
    await (await request.get(`${path}/items`)).json(),
  );

  expect((await request.post(`${path}/run`)).ok()).toBe(true);
  const second = feedItemListSchema.parse(
    await (await request.get(`${path}/items`)).json(),
  );

  // Same rows, same ids: the second run upserted the reused verdicts instead of
  // inserting (and re-judging) anything.
  expect(second.items.map((item) => item.id)).toEqual(
    first.items.map((item) => item.id),
  );
  const detail = feedDetailSchema.parse(await (await request.get(path)).json());
  expect(detail.sources[0]).toMatchObject({
    fetchedCount: 15,
    selectedCount: 1,
  });
});

test("deleting a feed removes it from the overview", async ({
  page,
  request,
}) => {
  const id = await seedFeed(request, { title: "Doomed" });
  await page.goto(`/feeds/${String(id)}/settings`);

  await page.getByRole("button", { name: "Delete feed" }).click();
  await page.getByRole("button", { name: "Yes, delete" }).click();

  await expect(page).toHaveURL("/feeds");
  await expect(page.getByText("No feeds yet")).toBeVisible();
});
