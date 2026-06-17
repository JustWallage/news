import { z } from "zod";

// Hacker News Firebase API. No auth, no key. We only model the fields we use;
// unknown fields are ignored by the schema.
const BASE = "https://hacker-news.firebaseio.com/v0";

const hnItemSchema = z.object({
  id: z.int(),
  type: z.string(),
  title: z.string().optional(),
  url: z.string().optional(),
  by: z.string().optional(),
  score: z.number().optional(),
  descendants: z.number().optional(),
  time: z.number().optional(),
  dead: z.boolean().optional(),
  deleted: z.boolean().optional(),
});
export type HnItem = z.infer<typeof hnItemSchema>;

const idListSchema = z.array(z.int());

/** The external dependency seam the digest pipeline depends on. */
export interface HnClient {
  topStoryIds(): Promise<number[]>;
  item(id: number): Promise<HnItem | null>;
}

export const realHnClient: HnClient = {
  async topStoryIds() {
    const res = await fetch(`${BASE}/topstories.json`);
    if (!res.ok) {
      throw new Error(`HN topstories failed (${res.status})`);
    }
    return idListSchema.parse(await res.json());
  },
  async item(id) {
    const res = await fetch(`${BASE}/item/${id}.json`);
    if (!res.ok) {
      throw new Error(`HN item ${id} failed (${res.status})`);
    }
    const data: unknown = await res.json();
    if (data === null) {
      return null;
    }
    const parsed = hnItemSchema.safeParse(data);
    return parsed.success ? parsed.data : null;
  },
};
