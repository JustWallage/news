import { eq } from "drizzle-orm";
import { preferences, telegram, type TelegramRow } from "../../db/schema";
import type { TelegramStatus } from "../../shared/api";
import type { Db } from "./db";
import { loadPreferences } from "./digest";
import type { TelegramUpdate } from "./telegram";

const LINK_CODE_TTL_MS = 15 * 60 * 1000;

const HELP = [
  "Commands:",
  "/set-preferences <text> — set what you want to read",
  "/cur-preferences — show your current preferences",
  "/daily-time HH:MM — daily summary time (or 'off' to clear)",
  "/daily-time-2 HH:MM — second daily summary",
  "/daily-time-3 HH:MM — third daily summary",
].join("\n");

const GREETING =
  "Welcome! To connect this chat, open the app's preferences page, " +
  "tap Connect Telegram, and send me /start <code>.";

const NOT_LINKED =
  "This chat is not linked yet. Open the app's preferences page, tap " +
  "Connect Telegram, and send me /start <code>.";

export function formatMinuteOfDay(min: number): string {
  const hours = Math.floor(min / 60);
  const minutes = min % 60;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
}

// "off"/"clear" → "off"; "HH:MM" → minute-of-day rounded to the nearest 5;
// anything else → null (invalid).
export function parseDailyTime(arg: string): number | "off" | null {
  const trimmed = arg.trim().toLowerCase();
  if (trimmed === "off" || trimmed === "clear") {
    return "off";
  }
  const match = /^(\d{1,2}):(\d{2})$/.exec(trimmed);
  if (match === null) {
    return null;
  }
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) {
    return null;
  }
  return (Math.round((hours * 60 + minutes) / 5) * 5) % 1440;
}

/** True when any configured slot matches the given minute-of-day. */
export function dueSlot(row: TelegramRow, minute: number): boolean {
  return [row.slot1, row.slot2, row.slot3].some((slot) => slot === minute);
}

function generateLinkCode(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(4));
  return [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function loadByEmail(
  db: Db,
  userEmail: string,
): Promise<TelegramRow | null> {
  const rows = await db
    .select()
    .from(telegram)
    .where(eq(telegram.userEmail, userEmail))
    .limit(1);
  return rows[0] ?? null;
}

async function loadByChat(db: Db, chatId: number): Promise<TelegramRow | null> {
  const rows = await db
    .select()
    .from(telegram)
    .where(eq(telegram.chatId, chatId))
    .limit(1);
  return rows[0] ?? null;
}

export async function loadTelegramStatus(
  db: Db,
  userEmail: string,
): Promise<TelegramStatus> {
  const row = await loadByEmail(db, userEmail);
  const slots = [row?.slot1, row?.slot2, row?.slot3].map((slot) =>
    slot === null || slot === undefined ? null : formatMinuteOfDay(slot),
  );
  return { linked: row?.chatId != null, slots };
}

export async function mintLinkCode(
  db: Db,
  userEmail: string,
  now: Date,
): Promise<{ code: string; expiresAt: Date }> {
  const code = generateLinkCode();
  const expiresAt = new Date(now.getTime() + LINK_CODE_TTL_MS);
  await db
    .insert(telegram)
    .values({ userEmail, linkCode: code, linkCodeExpiresAt: expiresAt })
    .onConflictDoUpdate({
      target: telegram.userEmail,
      set: { linkCode: code, linkCodeExpiresAt: expiresAt },
    });
  return { code, expiresAt };
}

async function handleStart(
  db: Db,
  chatId: number,
  code: string,
): Promise<string> {
  if (code === "") {
    return GREETING;
  }
  const rows = await db
    .select()
    .from(telegram)
    .where(eq(telegram.linkCode, code))
    .limit(1);
  const row = rows[0];
  if (
    row?.linkCodeExpiresAt == null ||
    row.linkCodeExpiresAt.getTime() < Date.now()
  ) {
    return "That code is invalid or expired. Generate a fresh one in the app.";
  }
  await db
    .update(telegram)
    .set({ chatId, linkCode: null, linkCodeExpiresAt: null })
    .where(eq(telegram.userEmail, row.userEmail));
  return `✅ Linked! I'll send your daily summaries here.\n\n${HELP}`;
}

async function setPreferences(
  db: Db,
  userEmail: string,
  text: string,
): Promise<string> {
  if (text === "") {
    return "Add the text after the command: /set-preferences <your interests>";
  }
  await db
    .insert(preferences)
    .values({ userEmail, text, updatedAt: new Date() })
    .onConflictDoUpdate({
      target: preferences.userEmail,
      set: { text, updatedAt: new Date() },
    });
  return "✅ Preferences updated.";
}

async function curPreferences(db: Db, userEmail: string): Promise<string> {
  const text = await loadPreferences(db, userEmail);
  return text.trim() === "" ? "No preferences set yet." : text;
}

const SLOT_SETTERS = [
  (value: number | null) => ({ slot1: value }),
  (value: number | null) => ({ slot2: value }),
  (value: number | null) => ({ slot3: value }),
];

async function setSlot(
  db: Db,
  row: TelegramRow,
  index: number,
  arg: string,
): Promise<string> {
  const label = `Daily summary ${index + 1}`;
  const command = index === 0 ? "/daily-time" : `/daily-time-${index + 1}`;
  if (arg === "") {
    const current = [row.slot1, row.slot2, row.slot3][index];
    return current === null || current === undefined
      ? `${label} is not set. Use ${command} HH:MM.`
      : `${label} is set to ${formatMinuteOfDay(current)}. Send "${command} off" to clear.`;
  }
  const parsed = parseDailyTime(arg);
  if (parsed === null) {
    return `Use ${command} HH:MM (e.g. ${command} 08:30) or ${command} off.`;
  }
  const value = parsed === "off" ? null : parsed;
  await db
    .update(telegram)
    .set(SLOT_SETTERS[index]?.(value) ?? {})
    .where(eq(telegram.userEmail, row.userEmail));
  return value === null
    ? `${label} cleared.`
    : `✅ ${label} set to ${formatMinuteOfDay(value)}.`;
}

// Resolves an incoming update to the reply to send back, applying any side
// effects (linking, preferences, slots). Returns null for updates the bot
// ignores (non-message, non-command). Pure with respect to Telegram itself —
// the caller sends the reply — so it is straightforward to unit-test.
export async function handleTelegramUpdate(
  db: Db,
  update: TelegramUpdate,
): Promise<{ chatId: number; reply: string } | null> {
  const message = update.message;
  if (message === undefined) {
    return null;
  }
  const text = message.text?.trim() ?? "";
  if (!text.startsWith("/")) {
    return null;
  }
  const chatId = message.chat.id;
  const [command, ...rest] = text.split(/\s+/);
  const arg = rest.join(" ").trim();

  if (command === "/start") {
    return { chatId, reply: await handleStart(db, chatId, arg) };
  }

  const row = await loadByChat(db, chatId);
  if (row === null) {
    return { chatId, reply: NOT_LINKED };
  }

  switch (command) {
    case "/set-preferences":
      return { chatId, reply: await setPreferences(db, row.userEmail, arg) };
    case "/cur-preferences":
      return { chatId, reply: await curPreferences(db, row.userEmail) };
    case "/daily-time":
      return { chatId, reply: await setSlot(db, row, 0, arg) };
    case "/daily-time-2":
      return { chatId, reply: await setSlot(db, row, 1, arg) };
    case "/daily-time-3":
      return { chatId, reply: await setSlot(db, row, 2, arg) };
    default:
      return { chatId, reply: HELP };
  }
}
