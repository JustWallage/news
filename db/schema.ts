import {
  integer,
  primaryKey,
  sqliteTable,
  text,
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

export type StoryRow = typeof stories.$inferSelect;
export type CurationRow = typeof curations.$inferSelect;
export type PreferenceRow = typeof preferences.$inferSelect;
