import { eq } from "drizzle-orm";
import { telegram, type TelegramRow } from "../../db/schema";
import type { TelegramStatus } from "../../shared/api";
import type { Db } from "./db";
import { loadPreferences, savePreferences } from "./digest";
import type { TelegramUpdate } from "./telegram";

const LINK_CODE_TTL_MS = 15 * 60 * 1000;

// The identifying bits of a Telegram chat, captured at link time so the app can
// show which chat is connected.
interface ChatIdentity {
  id: number;
  username: string | null;
  name: string | null;
}

const HELP = [
  "Commands:",
  "/user — show the connected account",
  "/fetch-feed — fetch a fresh feed now and send it here",
  "/set-preferences <text> — set what you want to read",
  "/cur-preferences — show your current preferences",
  "/daily-time HH:MM — daily summary time (or 'off' to clear)",
  "/daily-time-2 HH:MM — second daily summary",
  "/daily-time-3 HH:MM — third daily summary",
].join("\n");

// A friendly label for a connected chat: "@handle" if it has a username, else
// the stored display name, else null.
function chatLabel(row: TelegramRow): string | null {
  if (row.chatUsername !== null) {
    return `@${row.chatUsername}`;
  }
  return row.chatName;
}

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
  return {
    linked: row?.chatId != null,
    chatLabel: row?.chatId == null ? null : chatLabel(row),
    slots,
  };
}

/** The Telegram chat id bound to the user, or null when not linked. */
export async function loadChatId(
  db: Db,
  userEmail: string,
): Promise<number | null> {
  return (await loadByEmail(db, userEmail))?.chatId ?? null;
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
  chat: ChatIdentity,
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
    .set({
      chatId: chat.id,
      chatUsername: chat.username,
      chatName: chat.name,
      linkCode: null,
      linkCodeExpiresAt: null,
    })
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
  await savePreferences(db, userEmail, text);
  return "✅ Preferences updated.";
}

async function curPreferences(db: Db, userEmail: string): Promise<string> {
  const { text } = await loadPreferences(db, userEmail);
  return text.trim() === "" ? "No preferences set yet." : text;
}

function slotValue(row: TelegramRow, index: number): number | null {
  return index === 0 ? row.slot1 : index === 1 ? row.slot2 : row.slot3;
}

function slotPatch(index: number, value: number | null) {
  return index === 0
    ? { slot1: value }
    : index === 1
      ? { slot2: value }
      : { slot3: value };
}

async function setSlot(
  db: Db,
  row: TelegramRow,
  index: number,
  arg: string,
): Promise<string> {
  const label = `Daily summary ${index + 1}`;
  const command = index === 0 ? "/daily-time" : `/daily-time-${index + 1}`;
  if (arg === "") {
    const current = slotValue(row, index);
    return current === null
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
    .set(slotPatch(index, value))
    .where(eq(telegram.userEmail, row.userEmail));
  return value === null
    ? `${label} cleared.`
    : `✅ ${label} set to ${formatMinuteOfDay(value)}.`;
}

export interface TelegramReply {
  chatId: number;
  reply: string;
  // When set, the caller acknowledges `reply`, then runs a digest for this user
  // and sends the resulting feed to `chatId` in the background (it takes a few
  // seconds). Kept off the synchronous reply so the webhook acks Telegram fast.
  feedFor?: string;
}

// Resolves an incoming update to the reply to send back, applying any side
// effects (linking, preferences, slots). Returns null for updates the bot
// ignores (non-message, non-command). Pure with respect to Telegram itself —
// the caller sends the reply — so it is straightforward to unit-test.
export async function handleTelegramUpdate(
  db: Db,
  update: TelegramUpdate,
): Promise<TelegramReply | null> {
  const message = update.message;
  if (message === undefined) {
    return null;
  }
  const text = message.text?.trim() ?? "";
  if (!text.startsWith("/")) {
    return null;
  }
  const { id: chatId } = message.chat;
  const name = [message.chat.first_name, message.chat.last_name].filter(
    (part): part is string => part !== undefined && part !== "",
  );
  const chat: ChatIdentity = {
    id: chatId,
    username: message.chat.username ?? null,
    name: name.length > 0 ? name.join(" ") : null,
  };
  const [command, ...rest] = text.split(/\s+/);
  const arg = rest.join(" ").trim();

  if (command === "/start") {
    return { chatId, reply: await handleStart(db, chat, arg) };
  }

  const row = await loadByChat(db, chatId);
  if (row === null) {
    return { chatId, reply: NOT_LINKED };
  }

  switch (command) {
    case "/user":
      return { chatId, reply: `Connected account: ${row.userEmail}` };
    case "/fetch-feed":
      return {
        chatId,
        reply: "🔄 Fetching your latest feed — this may take a few seconds…",
        feedFor: row.userEmail,
      };
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
