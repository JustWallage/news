import { Hono } from "hono";
import {
  telegramLinkCodeSchema,
  telegramStatusSchema,
  telegramTimezoneSchema,
} from "../../shared/api";
import type { AppEnv } from "../env";
import { getDb } from "../lib/db";
import { parseJsonBody } from "../lib/http";
import {
  loadChatId,
  loadTelegramStatus,
  mintLinkCode,
  saveTimezone,
} from "../lib/telegram-bot";

export const telegramRoutes = new Hono<AppEnv>();

// Whether a chat is linked and the configured daily-summary times.
telegramRoutes.get("/", async (c) => {
  const db = getDb(c.env);
  const status = await loadTelegramStatus(db, c.get("userEmail"));
  return c.json(telegramStatusSchema.parse(status));
});

// Mint a one-time code (15-min expiry) for the user to send the bot as
// `/start <code>`; only the signed-in owner can reach this (behind auth). The
// body carries the browser timezone, stored so the daily summaries fire in it.
telegramRoutes.post("/link-code", async (c) => {
  const parsed = telegramTimezoneSchema.safeParse(
    await parseJsonBody(c.req.raw),
  );
  if (!parsed.success) {
    return c.json({ error: "Invalid request body" }, 400);
  }
  const db = getDb(c.env);
  const { code, expiresAt } = await mintLinkCode(
    db,
    c.get("userEmail"),
    parsed.data.timezone,
    new Date(),
  );
  const username = c.env.TELEGRAM_BOT_USERNAME;
  const url = username === "" ? null : `https://t.me/${username}?start=${code}`;
  return c.json(
    telegramLinkCodeSchema.parse({
      code,
      url,
      expiresAt: expiresAt.toISOString(),
    }),
  );
});

// Set the timezone the daily summaries are scheduled in (the preferences
// selector). Upserts even before the chat is linked.
telegramRoutes.put("/timezone", async (c) => {
  const parsed = telegramTimezoneSchema.safeParse(
    await parseJsonBody(c.req.raw),
  );
  if (!parsed.success) {
    return c.json({ error: "Invalid request body" }, 400);
  }
  const db = getDb(c.env);
  await saveTimezone(db, c.get("userEmail"), parsed.data.timezone);
  return c.json({ ok: true });
});

// Send a test message to the connected chat (the "Send test message" button).
telegramRoutes.post("/test", async (c) => {
  const db = getDb(c.env);
  const chatId = await loadChatId(db, c.get("userEmail"));
  if (chatId === null) {
    return c.json({ error: "Telegram is not connected" }, 409);
  }
  await c
    .get("deps")
    .telegram.sendMessage(chatId, "✅ Test message from your News bot.");
  return c.json({ ok: true });
});
