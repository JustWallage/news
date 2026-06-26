import { env } from "cloudflare:workers";
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { preferences, telegram } from "../../db/schema";
import { getDb } from "./db";
import {
  dueSlot,
  formatMinuteOfDay,
  handleTelegramUpdate,
  loadTelegramStatus,
  mintLinkCode,
  parseDailyTime,
  saveSlots,
  saveTimezone,
} from "./telegram-bot";

const USER = "user@example.test";
const CHAT = 4242;
const TZ = "America/New_York";

const message = (text: string, chatId = CHAT) => ({
  message: { chat: { id: chatId }, text },
});

const messageFrom = (
  text: string,
  chat: { id: number; username?: string; first_name?: string },
) => ({ message: { chat, text } });

beforeEach(async () => {
  const db = getDb(env);
  await db.delete(telegram);
  await db.delete(preferences);
});

describe("parseDailyTime", () => {
  it("rounds HH:MM to the nearest 5 minutes", () => {
    expect(parseDailyTime("08:32")).toBe(8 * 60 + 30);
    expect(parseDailyTime("08:33")).toBe(8 * 60 + 35);
    expect(parseDailyTime("00:00")).toBe(0);
    expect(parseDailyTime("23:45")).toBe(23 * 60 + 45);
  });

  it("treats off/clear as a clear", () => {
    expect(parseDailyTime("off")).toBe("off");
    expect(parseDailyTime("CLEAR")).toBe("off");
  });

  it("rejects junk and out-of-range values", () => {
    expect(parseDailyTime("nope")).toBeNull();
    expect(parseDailyTime("25:00")).toBeNull();
    expect(parseDailyTime("08:75")).toBeNull();
  });
});

describe("formatMinuteOfDay", () => {
  it("zero-pads hours and minutes", () => {
    expect(formatMinuteOfDay(0)).toBe("00:00");
    expect(formatMinuteOfDay(8 * 60 + 5)).toBe("08:05");
    expect(formatMinuteOfDay(23 * 60 + 45)).toBe("23:45");
  });
});

describe("dueSlot", () => {
  const row = {
    userEmail: USER,
    chatId: CHAT,
    chatUsername: null,
    chatName: null,
    linkCode: null,
    linkCodeExpiresAt: null,
    slot1: 485,
    slot2: null,
    slot3: 1170,
    timezone: null,
  };
  it("matches a configured slot only", () => {
    expect(dueSlot(row, 485)).toBe(true);
    expect(dueSlot(row, 1170)).toBe(true);
    expect(dueSlot(row, 486)).toBe(false);
  });
});

describe("handleTelegramUpdate", () => {
  it("links a chat with a valid /start code and rejects an expired one", async () => {
    const db = getDb(env);
    const { code } = await mintLinkCode(db, USER, TZ, new Date());

    const ok = await handleTelegramUpdate(db, message(`/start ${code}`));
    expect(ok?.reply).toContain("Linked");
    expect(ok?.reply).toContain(TZ);
    const status = await loadTelegramStatus(db, USER);
    expect(status.linked).toBe(true);
    expect(status.timezone).toBe(TZ);

    // Code is single-use: it was cleared on link.
    const reused = await handleTelegramUpdate(
      db,
      message(`/start ${code}`, 99),
    );
    expect(reused?.reply).toContain("invalid or expired");
  });

  it("refuses to link a chat already bound to another account", async () => {
    const db = getDb(env);
    const other = "someone-else@wallage.nl";

    // The chat links to USER first.
    const first = await mintLinkCode(db, USER, TZ, new Date());
    await handleTelegramUpdate(db, message(`/start ${first.code}`));
    expect((await loadTelegramStatus(db, USER)).linked).toBe(true);

    // The SAME chat then tries a fresh code minted by a different account.
    const second = await mintLinkCode(db, other, TZ, new Date());
    const res = await handleTelegramUpdate(
      db,
      message(`/start ${second.code}`),
    );
    expect(res?.reply).toContain("already linked to another account");

    // The original link is intact and the other account stays unlinked.
    expect((await loadTelegramStatus(db, USER)).linked).toBe(true);
    expect((await loadTelegramStatus(db, other)).linked).toBe(false);
  });

  it("rejects commands from an unlinked chat", async () => {
    const db = getDb(env);
    const res = await handleTelegramUpdate(db, message("/cur_preferences"));
    expect(res?.reply).toContain("not linked");
  });

  it("captures the chat label on link and reports the account via /user", async () => {
    const db = getDb(env);
    const { code } = await mintLinkCode(db, USER, TZ, new Date());
    await handleTelegramUpdate(
      db,
      messageFrom(`/start ${code}`, { id: CHAT, username: "just" }),
    );

    expect((await loadTelegramStatus(db, USER)).chatLabel).toBe("@just");

    const who = await handleTelegramUpdate(db, message("/user"));
    expect(who?.reply).toContain(USER);
  });

  it("acks /fetch and flags the feed to run for the linked account", async () => {
    const db = getDb(env);
    const { code } = await mintLinkCode(db, USER, TZ, new Date());
    await handleTelegramUpdate(db, message(`/start ${code}`));

    const res = await handleTelegramUpdate(db, message("/fetch"));
    expect(res?.reply).toContain("few seconds");
    expect(res?.feedFor).toBe(USER);
  });

  it("answers /help and falls back to help for unknown commands", async () => {
    const db = getDb(env);
    const { code } = await mintLinkCode(db, USER, TZ, new Date());
    await handleTelegramUpdate(db, message(`/start ${code}`));

    const help = await handleTelegramUpdate(db, message("/help"));
    expect(help?.reply).toContain("/fetch");
    expect(help?.reply).toContain("/help");

    const unknown = await handleTelegramUpdate(db, message("/bogus"));
    expect(unknown?.reply).toBe(help?.reply);
  });

  it("falls back to the name when the chat has no username", async () => {
    const db = getDb(env);
    const { code } = await mintLinkCode(db, USER, TZ, new Date());
    await handleTelegramUpdate(
      db,
      messageFrom(`/start ${code}`, { id: CHAT, first_name: "Just" }),
    );
    expect((await loadTelegramStatus(db, USER)).chatLabel).toBe("Just");
  });

  it("sets and reads preferences once linked", async () => {
    const db = getDb(env);
    const { code } = await mintLinkCode(db, USER, TZ, new Date());
    await handleTelegramUpdate(db, message(`/start ${code}`));

    const set = await handleTelegramUpdate(
      db,
      message("/set_preferences rust and self-hosting"),
    );
    expect(set?.reply).toContain("updated");
    const stored = await db
      .select()
      .from(preferences)
      .where(eq(preferences.userEmail, USER));
    expect(stored[0]?.text).toBe("rust and self-hosting");

    const cur = await handleTelegramUpdate(db, message("/cur_preferences"));
    expect(cur?.reply).toBe("rust and self-hosting");
  });

  it("rejects an over-long /set_preferences without saving", async () => {
    const db = getDb(env);
    const { code } = await mintLinkCode(db, USER, TZ, new Date());
    await handleTelegramUpdate(db, message(`/start ${code}`));

    const tooLong = `/set_preferences ${"a".repeat(1001)}`;
    const res = await handleTelegramUpdate(db, message(tooLong));
    expect(res?.reply).toContain("too long");
    const stored = await db
      .select()
      .from(preferences)
      .where(eq(preferences.userEmail, USER));
    expect(stored).toHaveLength(0);
  });

  it("sets, shows and clears a daily-time slot", async () => {
    const db = getDb(env);
    const { code } = await mintLinkCode(db, USER, TZ, new Date());
    await handleTelegramUpdate(db, message(`/start ${code}`));

    const set = await handleTelegramUpdate(db, message("/daily_time_2 08:32"));
    expect(set?.reply).toContain("08:30");
    expect((await loadTelegramStatus(db, USER)).slots).toEqual([
      null,
      "08:30",
      null,
    ]);

    const show = await handleTelegramUpdate(db, message("/daily_time_2"));
    expect(show?.reply).toContain("08:30");

    await handleTelegramUpdate(db, message("/daily_time_2 off"));
    expect((await loadTelegramStatus(db, USER)).slots[1]).toBeNull();
  });

  it("saves all three slots from the web UI, rounding and clearing", async () => {
    const db = getDb(env);
    const { code } = await mintLinkCode(db, USER, TZ, new Date());
    await handleTelegramUpdate(db, message(`/start ${code}`));

    await saveSlots(db, USER, ["08:32", null, "20:00"]);
    expect((await loadTelegramStatus(db, USER)).slots).toEqual([
      "08:30",
      null,
      "20:00",
    ]);

    await saveSlots(db, USER, [null, null, null]);
    expect((await loadTelegramStatus(db, USER)).slots).toEqual([
      null,
      null,
      null,
    ]);
  });

  it("disconnects a linked chat via /disconnect and returns to unlinked", async () => {
    const db = getDb(env);
    const { code } = await mintLinkCode(db, USER, TZ, new Date());
    await handleTelegramUpdate(db, message(`/start ${code}`));
    await saveSlots(db, USER, ["08:00", null, null]);
    expect((await loadTelegramStatus(db, USER)).linked).toBe(true);

    const res = await handleTelegramUpdate(db, message("/disconnect"));
    expect(res?.reply).toContain("Disconnected");

    const status = await loadTelegramStatus(db, USER);
    expect(status.linked).toBe(false);
    expect(status.slots).toEqual([null, null, null]);

    // Once unlinked, the chat is treated as a stranger again.
    const after = await handleTelegramUpdate(db, message("/disconnect"));
    expect(after?.reply).toContain("not linked");
  });

  it("ignores non-command and non-message updates", async () => {
    const db = getDb(env);
    expect(await handleTelegramUpdate(db, message("hello"))).toBeNull();
    expect(await handleTelegramUpdate(db, {})).toBeNull();
  });
});

describe("saveTimezone", () => {
  it("inserts then updates the timezone for a user without a chat", async () => {
    const db = getDb(env);
    await saveTimezone(db, USER, TZ);
    expect((await loadTelegramStatus(db, USER)).timezone).toBe(TZ);

    await saveTimezone(db, USER, "Asia/Tokyo");
    expect((await loadTelegramStatus(db, USER)).timezone).toBe("Asia/Tokyo");
  });
});
