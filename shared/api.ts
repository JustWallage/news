import { z } from "zod";

// ---- Identity ----

export const meSchema = z.object({ email: z.string() });

export const healthSchema = z.object({
  ok: z.literal(true),
  email: z.string(),
});

export const okSchema = z.object({ ok: z.literal(true) });

// ---- Stories ----

export const storySchema = z.object({
  /** Hacker News item id. */
  id: z.int(),
  title: z.string(),
  /** Outbound link; null for Ask/Show HN self-posts. */
  url: z.string().nullable(),
  by: z.string(),
  score: z.int(),
  /** HN `descendants` (comment count). */
  comments: z.int(),
  /** HN submission time. */
  time: z.iso.datetime(),
  /** 0–100 relevance from the AI filter (0 for the unfiltered fallback). */
  relevanceScore: z.int(),
  /** Short AI rationale (stored, not shown in v1). */
  reason: z.string(),
  /** When the user first opened this story; null until opened. */
  openedAt: z.iso.datetime().nullable(),
});
export type Story = z.infer<typeof storySchema>;

export const storyListSchema = z.object({ stories: z.array(storySchema) });
export type StoryList = z.infer<typeof storyListSchema>;

// ---- Preferences ----

export const preferencesSchema = z.object({
  text: z.string(),
  updatedAt: z.iso.datetime().nullable(),
});

export const preferencesUpdateSchema = z.object({
  text: z.string().max(10000),
});

// ---- Digest ----

export const digestRunResultSchema = z.object({ count: z.int() });

// ---- Telegram ----

export const telegramStatusSchema = z.object({
  /** Whether a Telegram chat is bound to this account. */
  linked: z.boolean(),
  /** Human label for the connected chat ("@handle" or name); null if unknown. */
  chatLabel: z.string().nullable(),
  /** The three daily-summary slots as "HH:MM", null when unset. */
  slots: z.array(z.string().nullable()).length(3),
});
export type TelegramStatus = z.infer<typeof telegramStatusSchema>;

// One daily-summary time as "HH:MM" (24h), or null to leave that slot unset.
const telegramSlotSchema = z
  .string()
  .regex(/^([01]\d|2[0-3]):[0-5]\d$/)
  .nullable();

export const telegramSlotsUpdateSchema = z.object({
  slots: z.array(telegramSlotSchema).length(3),
});

export const telegramLinkCodeSchema = z.object({
  /** One-time code to send the bot as `/start <code>`. */
  code: z.string(),
  /** `t.me` deep link, or null when the bot username is not configured. */
  url: z.string().nullable(),
  expiresAt: z.iso.datetime(),
});
export type TelegramLinkCode = z.infer<typeof telegramLinkCodeSchema>;
