import {
  index,
  integer,
  primaryKey,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

// Global, persistent cache of story CONTENT, keyed by the Hacker News item id.
// The digest only downloads items that are missing or stale (see worker/lib/
// digest.ts); rows are never deleted. This is shared across all users.
export const stories = sqliteTable("stories", {
  id: integer("id").primaryKey(),
  title: text("title").notNull(),
  url: text("url"),
  by: text("by").notNull(),
  score: integer("score").notNull(),
  comments: integer("comments").notNull(),
  time: integer("time", { mode: "timestamp" }).notNull(),
  fetchedAt: integer("fetched_at", { mode: "timestamp" }).notNull(),
});

// Per-user curation: which cached stories were selected for a user, and whether
// they are in that user's CURRENT feed. A digest run flips every row for the
// user to current=false, then upserts the freshly selected ones to current=true
// (preserving openedAt). Older rows stay as the user's archive.
export const curations = sqliteTable(
  "curations",
  {
    userEmail: text("user_email").notNull(),
    storyId: integer("story_id")
      .notNull()
      .references(() => stories.id),
    relevanceScore: integer("relevance_score").notNull(),
    reason: text("reason").notNull(),
    relevant: integer("relevant", { mode: "boolean" }).notNull().default(true),
    prefVersion: integer("pref_version").notNull().default(0),
    curatedAt: integer("curated_at", { mode: "timestamp" }).notNull(),
    current: integer("current", { mode: "boolean" }).notNull(),
    openedAt: integer("opened_at", { mode: "timestamp" }),
  },
  (t) => [primaryKey({ columns: [t.userEmail, t.storyId] })],
);

// Single-row-per-user blob of plain-text interests, keyed by the owner's email.
export const preferences = sqliteTable("preferences", {
  userEmail: text("user_email").primaryKey(),
  text: text("text").notNull(),
  // Monotonic counter bumped on every real edit; stamped onto each curation so a
  // digest can skip stories already judged against the current preferences.
  version: integer("version").notNull().default(1),
  updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
});

// One row per user linking a Telegram chat to the account. The webhook looks
// chats up by chatId; linkCode holds the pending one-time code minted by the
// web UI (cleared once /start consumes it). slot1-3 are daily-summary times as
// minute-of-day (0-1439, rounded to 5); null means that slot is unset. timezone
// is the user's IANA zone the slots are interpreted in; null falls back to
// Europe/Amsterdam.
export const telegram = sqliteTable(
  "telegram",
  {
    userEmail: text("user_email").primaryKey(),
    chatId: integer("chat_id"),
    chatUsername: text("chat_username"),
    chatName: text("chat_name"),
    linkCode: text("link_code"),
    linkCodeExpiresAt: integer("link_code_expires_at", { mode: "timestamp" }),
    slot1: integer("slot1"),
    slot2: integer("slot2"),
    slot3: integer("slot3"),
    timezone: text("timezone"),
  },
  (t) => [uniqueIndex("telegram_chat_id_idx").on(t.chatId)],
);

// One row per active login session. The cookie carries an opaque random token;
// the row id is that token's SHA-256 hex, so a DB read alone never yields a
// usable cookie. Expired rows are ignored at lookup time and purged nightly.
export const sessions = sqliteTable("sessions", {
  id: text("id").primaryKey(),
  userEmail: text("user_email").notNull(),
  expiresAt: integer("expires_at", { mode: "timestamp" }).notNull(),
});

// Per-user timestamp of the last on-demand digest run, used to rate-limit the
// expensive Workers AI curation (POST /api/digest/run). One row per user.
export const digestRuns = sqliteTable("digest_runs", {
  userEmail: text("user_email").primaryKey(),
  lastRunAt: integer("last_run_at", { mode: "timestamp" }).notNull(),
});

// A user-created feed: its own AI-curation preferences (versioned like the
// global `preferences` row) and up to three daily Telegram slots, interpreted in
// the owner's `telegram.timezone`. `lastFetchedAt` doubles as the on-demand run
// cooldown stamp.
export const feeds = sqliteTable(
  "feeds",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    userEmail: text("user_email").notNull(),
    title: text("title").notNull(),
    preferencesText: text("preferences_text").notNull().default(""),
    prefVersion: integer("pref_version").notNull().default(1),
    slot1: integer("slot1"),
    slot2: integer("slot2"),
    slot3: integer("slot3"),
    lastFetchedAt: integer("last_fetched_at", { mode: "timestamp" }),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
  },
  (t) => [index("feeds_user_email_idx").on(t.userEmail)],
);

export const feedSources = sqliteTable(
  "feed_sources",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    feedId: integer("feed_id")
      .notNull()
      .references(() => feeds.id),
    url: text("url").notNull(),
    title: text("title").notNull(),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
  },
  (t) => [uniqueIndex("feed_sources_feed_id_url_idx").on(t.feedId, t.url)],
);

// Fetched RSS items with their AI verdict inline (feeds are single-owner, so no
// join table): `relevant`/`pref_version` mirror `curations`' sticky-verdict
// reuse, `current` marks membership of the latest fetch, and `sentAt` is the
// send-once guard — an item is delivered to Telegram at most once, ever.
export const feedItems = sqliteTable(
  "feed_items",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    feedId: integer("feed_id")
      .notNull()
      .references(() => feeds.id),
    // Which source yielded this link (first one wins the dedupe). Deliberately
    // NOT a foreign key: removing a source must neither fail nor take its
    // already-judged items with it. Null on rows written before attribution.
    sourceId: integer("source_id"),
    link: text("link").notNull(),
    title: text("title").notNull(),
    description: text("description"),
    publishedAt: integer("published_at", { mode: "timestamp" }),
    fetchedAt: integer("fetched_at", { mode: "timestamp" }).notNull(),
    relevant: integer("relevant", { mode: "boolean" }).notNull().default(true),
    relevanceScore: integer("relevance_score").notNull().default(0),
    prefVersion: integer("pref_version").notNull().default(0),
    current: integer("current", { mode: "boolean" }).notNull(),
    sentAt: integer("sent_at", { mode: "timestamp" }),
  },
  (t) => [uniqueIndex("feed_items_feed_id_link_idx").on(t.feedId, t.link)],
);

export type StoryRow = typeof stories.$inferSelect;
export type CurationRow = typeof curations.$inferSelect;
export type PreferenceRow = typeof preferences.$inferSelect;
export type TelegramRow = typeof telegram.$inferSelect;
export type FeedRow = typeof feeds.$inferSelect;
export type FeedSourceRow = typeof feedSources.$inferSelect;
export type FeedItemRow = typeof feedItems.$inferSelect;
