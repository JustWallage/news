import type { APIRequestContext } from "@playwright/test";
import { feedCreatedSchema, telegramLinkCodeSchema } from "@shared/api";
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

test("the dropdown switches between feeds and All feeds returns to the overview", async ({
  page,
  request,
}) => {
  const first = await seedFeed(request, { title: "First feed" });
  const second = await seedFeed(request, { title: "Second feed" });

  await page.goto(`/feeds/${String(first)}`);
  const select = page.getByLabel("Selected feed");
  await expect(select).toHaveValue(String(first));

  await select.selectOption(String(second));
  await expect(page).toHaveURL(`/feeds/${String(second)}`);
  await expect(page.getByLabel("Selected feed")).toHaveValue(String(second));

  await page.getByRole("link", { name: "← All feeds" }).click();
  await expect(page).toHaveURL("/feeds");
  await expect(page.getByText("First feed")).toBeVisible();
  await expect(page.getByText("Second feed")).toBeVisible();
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
  const run = await request.post(`/api/feeds/${String(id)}/run`);
  expect(run.ok()).toBe(true);

  await page.goto(`/feeds/${String(id)}/archive`);
  await expect(page.getByText("Rust in the kernel, one year in")).toBeVisible();
  await expect(
    page.getByText("Bitcoin custody for grandmothers"),
  ).toBeVisible();
  await expect(page.getByText("Sample article 0")).toBeHidden();
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
