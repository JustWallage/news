import { z } from "zod";
import type { StoryInput } from "./digest";

// Algolia's Hacker News API returns the whole front page WITH content in a
// single request — no per-item fetches — which keeps the digest well under the
// Workers subrequest limit. `tags=front_page` mirrors the HN front page.
const FRONT_PAGE_URL =
  "https://hn.algolia.com/api/v1/search?tags=front_page&hitsPerPage=50";

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
    return data.hits.flatMap((hit) => {
      if (hit.title === null || hit.author === null) {
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
