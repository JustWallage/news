import { z } from "zod";
import type { StoryInput } from "./digest";

// Algolia's Hacker News API returns the whole front page WITH content in a
// single request — no per-item fetches — which keeps the digest well under the
// Workers subrequest limit. `tags=front_page,story` is front-page STORIES only
// (the `story` tag excludes job posts); the default `search` ranking keeps the
// high-signal stories on top.
const FRONT_PAGE_URL =
  "https://hn.algolia.com/api/v1/search?tags=front_page,story&hitsPerPage=50";

// The front_page tag retains recently-front-paged stories, so its long tail
// includes months-old, low-point stragglers. Drop anything older than this — the
// real front page is always recent.
const MAX_AGE_SECONDS = 5 * 24 * 60 * 60;

const hitSchema = z.object({
  objectID: z.string(),
  title: z.string().nullable(),
  url: z.string().nullable().optional(),
  author: z.string().nullable(),
  points: z.number().nullable().optional(),
  num_comments: z.number().nullable().optional(),
  created_at_i: z.number(),
});
const responseSchema = z.object({ hits: z.array(hitSchema) });

/** The external dependency seam the digest pipeline depends on. */
export interface HnClient {
  frontPage(): Promise<StoryInput[]>;
}

export const realHnClient: HnClient = {
  async frontPage() {
    const res = await fetch(FRONT_PAGE_URL);
    if (!res.ok) {
      throw new Error(`Algolia front page failed (${res.status})`);
    }
    const data = responseSchema.parse(await res.json());
    const cutoff = Math.floor(Date.now() / 1000) - MAX_AGE_SECONDS;
    return data.hits.flatMap((hit) => {
      if (hit.title === null || hit.author === null) {
        return [];
      }
      if (hit.created_at_i < cutoff) {
        return [];
      }
      const id = Number(hit.objectID);
      if (!Number.isInteger(id)) {
        return [];
      }
      return [
        {
          id,
          title: hit.title,
          url: hit.url ?? null,
          by: hit.author,
          score: hit.points ?? 0,
          comments: hit.num_comments ?? 0,
          time: hit.created_at_i,
        },
      ];
    });
  },
};
