import { Hono } from "hono";
import { telegramLinkCodeSchema, telegramStatusSchema } from "../../shared/api";
import type { AppEnv } from "../env";
import { getDb } from "../lib/db";
import { loadTelegramStatus, mintLinkCode } from "../lib/telegram-bot";

export const telegramRoutes = new Hono<AppEnv>();

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
