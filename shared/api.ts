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
