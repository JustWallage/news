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

// Public, unauthenticated projection: HN-public fields only, never the per-user
// curation fields (openedAt/relevanceScore/reason).
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

// ---- Feeds ----

export const FEED_TITLE_MAX_LENGTH = 100;
// Bounds the RSS fetch fan-out per run (Workers caps subrequests at 50).
export const MAX_FEED_SOURCES = 10;

export const feedSummarySchema = z.object({
  id: z.int(),
  title: z.string(),
  preferencesText: z.string(),
});

export const feedListSchema = z.object({ feeds: z.array(feedSummarySchema) });

const feedTitleSchema = z.string().trim().min(1).max(FEED_TITLE_MAX_LENGTH);

export const feedCreateSchema = z.object({ title: feedTitleSchema });

export const feedCreatedSchema = z.object({ id: z.int() });

export const feedUpdateSchema = z.object({
  title: feedTitleSchema,
  preferencesText: z.string().max(PREFERENCES_MAX_LENGTH),
});

export const feedSourceSchema = z.object({
  id: z.int(),
  url: z.string(),
  title: z.string(),
  /** Items ever stored from this source (attribution is first-source-wins). */
  fetchedCount: z.int(),
  /** How many of those the AI judged relevant. */
  selectedCount: z.int(),
});

export const feedSourceCreateSchema = z.object({
  url: z.string().refine(isHttpUrl, "must be an http(s) URL"),
});

export const feedDetailSchema = z.object({
  id: z.int(),
  title: z.string(),
  preferencesText: z.string(),
  sources: z.array(feedSourceSchema),
  /** The three daily-digest slots as "HH:MM", null when unset. */
  slots: z.array(z.string().nullable()).length(3),
  /** Whether a Telegram chat is linked (slots only take effect when true). */
  telegramLinked: z.boolean(),
  lastFetchedAt: z.iso.datetime().nullable(),
});

export const feedItemSchema = z.object({
  id: z.int(),
  title: z.string(),
  url: z.string(),
  publishedAt: z.iso.datetime().nullable(),
  /** 0–100 relevance from the AI filter (0 for the empty-preferences fallback). */
  relevanceScore: z.int(),
});
export type FeedItem = z.infer<typeof feedItemSchema>;

export const feedItemListSchema = z.object({
  items: z.array(feedItemSchema),
  lastFetchedAt: z.iso.datetime().nullable(),
});

// One source's items with their verdict, for the settings drill-down: `selected`
// is the sticky AI verdict, so a caller can show fetched-vs-selected side by side.
export const feedSourceItemSchema = feedItemSchema.extend({
  selected: z.boolean(),
});

export const feedSourceItemListSchema = z.object({
  items: z.array(feedSourceItemSchema),
});
export type FeedSourceItem = z.infer<typeof feedSourceItemSchema>;

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
