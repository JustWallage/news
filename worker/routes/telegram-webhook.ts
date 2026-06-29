import { Hono } from "hono";
import type { AppEnv } from "../env";
import { timingSafeEqual } from "../lib/crypto";
import { getDb } from "../lib/db";
import { createDeps } from "../lib/deps";
import { sendDailyDigest } from "../lib/scheduled";
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
  const now = new Date();
  const result = await handleTelegramUpdate(db, parsed.data, {
    cooldownMs: c.env.DIGEST_COOLDOWN_SECONDS * 1000,
    now,
  });
  if (result !== null) {
    const deps = createDeps(c.env);
    await deps.telegram.sendMessage(result.chatId, result.reply);
    // /fetch: run the digest and send the feed after acking — it takes a
    // few seconds, so it runs in the background rather than blocking the reply.
    // The cooldown decision and run were already recorded synchronously above.
    if (result.feedFor !== undefined) {
      c.executionCtx.waitUntil(
        sendDailyDigest(
          db,
          deps,
          result.feedFor,
          result.chatId,
          c.env.APP_URL,
          now,
        ),
      );
    }
  }
  return c.json({ ok: true });
});
