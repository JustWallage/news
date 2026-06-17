import { Hono } from "hono";
import type { AppEnv } from "../env";
import { timingSafeEqual } from "../lib/crypto";
import { getDb } from "../lib/db";
import { createDeps } from "../lib/deps";
import { updateSchema } from "../lib/telegram";
import { handleTelegramUpdate } from "../lib/telegram-bot";

export const telegramWebhookRoutes = new Hono<AppEnv>();

async function parseJsonBody(req: Request): Promise<unknown> {
  try {
    return await req.json();
  } catch {
    return null;
  }
}

// Telegram delivers updates here. This path sits OUTSIDE /api (no CF Access
// identity is available) and is authenticated solely by the secret token that
// was registered with setWebhook; a missing/wrong secret fails closed.
telegramWebhookRoutes.post("/webhook", async (c) => {
  const secret = c.env.TELEGRAM_WEBHOOK_SECRET;
  const given = c.req.header("X-Telegram-Bot-Api-Secret-Token");
  if (
    secret === undefined ||
    secret === "" ||
    given === undefined ||
    !(await timingSafeEqual(secret, given))
  ) {
    return c.json({ error: "Forbidden" }, 403);
  }
  const parsed = updateSchema.safeParse(await parseJsonBody(c.req.raw));
  // Acknowledge anything we can't parse so Telegram stops retrying it.
  if (!parsed.success) {
    return c.json({ ok: true });
  }
  const db = getDb(c.env);
  const result = await handleTelegramUpdate(db, parsed.data);
  if (result !== null) {
    await createDeps(c.env).telegram.sendMessage(result.chatId, result.reply);
  }
  return c.json({ ok: true });
});
