import { storySchema, type Story } from "../../shared/api";

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
