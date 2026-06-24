import type { APIRequestContext } from "@playwright/test";
import { telegramLinkCodeSchema, telegramStatusSchema } from "@shared/api";
import { expect, test } from "./fixtures";

// The e2e webhook secret: the committed default for the local/hermetic run, or
// the per-run value minted by CI for the internet-reachable ephemeral worker
// (see ephemeral-e2e.yml). Lets the suite drive the bot webhook to link/unlink a
// chat without a real Telegram round-trip.
const WEBHOOK_SECRET = process.env.E2E_WEBHOOK_SECRET ?? "e2e-webhook-secret";

// Links a chat to the test user the way production does: mint a code, then send
// the bot a `/start <code>` via the webhook. Returns the chat id (unique per
// test, so parallel runs don't collide on the chat_id index) and `@handle`.
async function linkChat(
  request: APIRequestContext,
): Promise<{ chatId: number; label: string }> {
  const chatId = Math.floor(Math.random() * 1_000_000_000);
  const username = `e2e_${chatId}`;
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
        chat: { id: chatId, username },
        text: `/start ${minted.code}`,
      },
    },
  });
  expect(linked.status()).toBe(200);
  return { chatId, label: `@${username}` };
}

test("the preferences page reveals a Telegram connect code with a copy button", async ({
  page,
}) => {
  await page.context().grantPermissions(["clipboard-write"]);
  await page.goto("/preferences");
  await expect(page.getByText(/Connected to Telegram/)).toBeHidden();
  // The daily-summaries card is only offered once a chat is linked.
  await expect(page.getByText("Daily summaries")).toBeHidden();

  await page.getByRole("button", { name: "Generate connect link" }).click();

  await expect(page.getByText(/\/start [0-9a-f]{16}/)).toBeVisible();
  await expect(page.getByText(/expires in 15 minutes/)).toBeVisible();

  const copy = page.getByRole("button", { name: "Copy" });
  await expect(copy).toBeVisible();
  await copy.click();
  await expect(page.getByRole("button", { name: "Copied" })).toBeVisible();
});

test("the timezone selector persists the chosen zone", async ({
  page,
  request,
}) => {
  // The timezone selector lives in the daily-summaries card, shown once linked.
  await linkChat(request);
  await page.goto("/preferences");
  const select = page.getByLabel("Timezone");
  await Promise.all([
    page.waitForResponse(
      (r) =>
        r.url().includes("/api/telegram/timezone") &&
        r.request().method() === "PUT",
    ),
    select.selectOption("Asia/Tokyo"),
  ]);

  await page.reload();
  await expect(page.getByLabel("Timezone")).toHaveValue("Asia/Tokyo");
});

test("disconnects Telegram from the preferences page after confirming", async ({
  page,
  request,
  userEmail,
}) => {
  const { label } = await linkChat(request);

  await page.goto("/preferences");
  await expect(
    page.getByText(`Connected to Telegram as ${label}.`),
  ).toBeVisible();
  // The connected card names both the Telegram account and the linked email.
  await expect(
    page.getByText(`Summaries for ${userEmail} are delivered to this chat.`),
  ).toBeVisible();
  await expect(page.getByText("Daily summaries")).toBeVisible();

  await page.getByRole("button", { name: "Disconnect", exact: true }).click();
  await expect(page.getByText("Disconnect Telegram?")).toBeVisible();
  await page.getByRole("button", { name: "Yes, disconnect" }).click();

  await expect(page.getByText(/Connected to Telegram/)).toBeHidden();
  await expect(page.getByText("Daily summary times")).toBeHidden();
  await expect(
    page.getByRole("button", { name: "Disconnect", exact: true }),
  ).toBeHidden();
});

test("clears a saved daily summary time with the trash button", async ({
  page,
  request,
}) => {
  await linkChat(request);
  await page.goto("/preferences");

  const first = page.getByLabel("First daily summary time", { exact: true });
  const save = page.getByRole("button", { name: "Save times" });
  const slotsSaved = (): Promise<unknown> =>
    page.waitForResponse(
      (r) =>
        r.url().includes("/api/telegram/slots") &&
        r.request().method() === "PUT",
    );

  await first.fill("08:00");
  await Promise.all([slotsSaved(), save.click()]);

  // The trash button is the only way to clear a set time.
  await page
    .getByRole("button", { name: "Clear First daily summary time" })
    .click();
  await expect(first).toHaveValue("");
  await Promise.all([slotsSaved(), save.click()]);

  await page.reload();
  await expect(
    page.getByLabel("First daily summary time", { exact: true }),
  ).toHaveValue("");
});

test("an empty daily summary slot reads as Not set", async ({
  page,
  request,
}) => {
  await linkChat(request);
  await page.goto("/preferences");

  const first = page.getByLabel("First daily summary time", { exact: true });
  const firstRow = page.locator("div", { has: first }).last();
  await expect(firstRow.getByText("Not set")).toBeVisible();

  const save = page.getByRole("button", { name: "Save times" });
  await first.fill("08:00");
  await Promise.all([
    page.waitForResponse(
      (r) =>
        r.url().includes("/api/telegram/slots") &&
        r.request().method() === "PUT",
    ),
    save.click(),
  ]);

  // A set slot offers the clear button instead of the "Not set" cue.
  await expect(firstRow.getByText("Not set")).toBeHidden();
  await expect(
    page.getByRole("button", { name: "Clear First daily summary time" }),
  ).toBeVisible();
});

test("the /disconnect bot command unlinks the chat", async ({ request }) => {
  const { chatId } = await linkChat(request);

  const before = telegramStatusSchema.parse(
    await (await request.get("/api/telegram")).json(),
  );
  expect(before.linked).toBe(true);

  const res = await request.post("/telegram/webhook", {
    headers: { "X-Telegram-Bot-Api-Secret-Token": WEBHOOK_SECRET },
    data: { message: { chat: { id: chatId }, text: "/disconnect" } },
  });
  expect(res.status()).toBe(200);

  const after = telegramStatusSchema.parse(
    await (await request.get("/api/telegram")).json(),
  );
  expect(after.linked).toBe(false);
});
