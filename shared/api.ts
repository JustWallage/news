import { z } from "zod";

// ---- Identity ----

export const meSchema = z.object({ email: z.string() });

// Public client config served by GET /auth/config. `turnstileSiteKey` is null
// when Cloudflare Turnstile is not configured (local/e2e), so the sign-in screen
// renders the plain button instead of the challenge widget.
export const authConfigSchema = z.object({
  turnstileSiteKey: z.string().nullable(),
});

export const healthSchema = z.object({
  ok: z.literal(true),
  email: z.string(),
});

export const okSchema = z.object({ ok: z.literal(true) });

// ---- URLs ----

// http(s) are the only schemes we ever render as a clickable link. Story URLs
// come from an upstream (Algolia/HN), so this is enforced at ingestion and again
// at each render sink (SPA anchor, Telegram href) rather than trusting the source
// — a `javascript:`/`data:` URL must never reach an href.
export function isHttpUrl(value: string): boolean {
  try {
    const { protocol } = new URL(value);
    return protocol === "http:" || protocol === "https:";
  } catch {
    return false;
  }
}

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

// The public demo feed (GET /public/feed) is served WITHOUT a session, so it
// exposes only HN-public story fields — never the per-user curation fields
// (openedAt, relevanceScore, reason). Derived from storySchema so it can never
// drift into leaking a field a future storySchema change adds.
export const publicStorySchema = storySchema.pick({
  id: true,
  title: true,
  url: true,
  by: true,
  score: true,
  comments: true,
  time: true,
});
export type PublicStory = z.infer<typeof publicStorySchema>;

// `preferences` is the owner's plain-text interests blob (empty when unset),
// shown on the demo so visitors see what the feed is filtered against.
// lastCuratedAt is the owner's latest curatedAt, for the "last refreshed X" line
// (null when the owner has no current curations).
export const demoFeedSchema = z.object({
  stories: z.array(publicStorySchema),
  preferences: z.string(),
  lastCuratedAt: z.iso.datetime().nullable(),
});
export type DemoFeed = z.infer<typeof demoFeedSchema>;

// ---- Preferences ----

export const preferencesSchema = z.object({
  text: z.string(),
  updatedAt: z.iso.datetime().nullable(),
});

// A plain-text interests blob is short by nature; cap it so neither the web PUT
// nor the Telegram /set_preferences path can store an unbounded payload.
export const PREFERENCES_MAX_LENGTH = 1000;

export const preferencesUpdateSchema = z.object({
  text: z.string().max(PREFERENCES_MAX_LENGTH),
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
  /** IANA zone the slots are interpreted in; null falls back to Europe/Amsterdam. */
  timezone: z.string().nullable(),
});
export type TelegramStatus = z.infer<typeof telegramStatusSchema>;

function isValidTimeZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

// Request body for both POST /telegram/link-code and PUT /telegram/timezone.
export const telegramTimezoneSchema = z.object({
  timezone: z.string().refine(isValidTimeZone, "invalid IANA time zone"),
});

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
