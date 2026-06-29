import {
  publicStorySchema,
  storySchema,
  type PublicStory,
  type Story,
} from "../../shared/api";

// The joined shape produced by the feed query (story content + this user's
// curation fields).
export interface FeedRow {
  id: number;
  title: string;
  url: string | null;
  by: string;
  score: number;
  comments: number;
  time: Date;
  relevanceScore: number;
  reason: string;
  openedAt: Date | null;
}

// Responses are zod-parsed so a drifting DB row can never silently produce an
// out-of-contract payload.
export function toStory(row: FeedRow): Story {
  return storySchema.parse({
    id: row.id,
    title: row.title,
    url: row.url,
    by: row.by,
    score: row.score,
    comments: row.comments,
    time: row.time.toISOString(),
    relevanceScore: row.relevanceScore,
    reason: row.reason,
    openedAt: row.openedAt === null ? null : row.openedAt.toISOString(),
  });
}

// The public-safe projection for the anonymous demo feed: HN-public fields only,
// never the per-user curation fields.
export function toPublicStory(
  row: Pick<
    FeedRow,
    "id" | "title" | "url" | "by" | "score" | "comments" | "time"
  >,
): PublicStory {
  return publicStorySchema.parse({
    id: row.id,
    title: row.title,
    url: row.url,
    by: row.by,
    score: row.score,
    comments: row.comments,
    time: row.time.toISOString(),
  });
}
