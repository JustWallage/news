import { Hono } from "hono";
import {
  telegramLinkCodeSchema,
  telegramSlotsUpdateSchema,
  telegramStatusSchema,
} from "../../shared/api";
import type { AppEnv } from "../env";
import { getDb } from "../lib/db";
import {
  loadChatId,
  loadTelegramStatus,
  mintLinkCode,
  saveSlots,
} from "../lib/telegram-bot";

export const telegramRoutes = new Hono<AppEnv>();

async function parseJsonBody(req: Request): Promise<unknown> {
  try {
    return await req.json();
  } catch {
    return null;
  }
}

// Whether a chat is linked and the configured daily-summary times.
telegramRoutes.get("/", async (c) => {
  const db = getDb(c.env);
  const status = await loadTelegramStatus(db, c.get("userEmail"));
  return c.json(telegramStatusSchema.parse(status));
});

// Mint a one-time code (15-min expiry) for the user to send the bot as
// `/start <code>`; only the signed-in owner can reach this (behind auth).
telegramRoutes.post("/link-code", async (c) => {
  const db = getDb(c.env);
  const { code, expiresAt } = await mintLinkCode(
    db,
    c.get("userEmail"),
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

// Set the three daily-summary times from the web UI. Only available once a chat
// is linked (the times have no effect otherwise, and the row must exist).
telegramRoutes.put("/slots", async (c) => {
  const db = getDb(c.env);
  const userEmail = c.get("userEmail");
  if ((await loadChatId(db, userEmail)) === null) {
    return c.json({ error: "Telegram is not connected" }, 409);
  }
  const parsed = telegramSlotsUpdateSchema.safeParse(
    await parseJsonBody(c.req.raw),
  );
  if (!parsed.success) {
    return c.json({ error: "Invalid request body" }, 400);
  }
  await saveSlots(db, userEmail, parsed.data.slots);
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
