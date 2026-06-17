import type { AiFilter, StoryInput } from "./digest";
import type { HnClient } from "./hn";

// Deterministic stand-ins for the Algolia HN API + Workers AI, used in every
// environment except production (see lib/deps.ts). They make `pnpm dev` show
// realistic data and let e2e steer the feed purely through the preferences text.

const CANNED: StoryInput[] = [
  {
    id: 1001,
    title: "Rust's new borrow checker lands",
    url: "https://example.com/rust",
    by: "alice",
    score: 412,
    comments: 88,
    time: 1700000000,
  },
  {
    id: 1002,
    title: "Bitcoin hits a new all-time high",
    url: "https://example.com/btc",
    by: "bob",
    score: 230,
    comments: 150,
    time: 1700000100,
  },
  {
    id: 1003,
    title: "Self-hosting your email in 2026",
    url: "https://example.com/email",
    by: "carol",
    score: 198,
    comments: 64,
    time: 1700000200,
  },
  {
    id: 1004,
    title: "Show HN: a weekend Postgres clone",
    url: null,
    by: "dave",
    score: 95,
    comments: 12,
    time: 1700000300,
  },
  {
    id: 1005,
    title: "The economics of LLM inference",
    url: "https://example.com/llm",
    by: "erin",
    score: 320,
    comments: 110,
    time: 1700000400,
  },
  {
    id: 1006,
    title: "Ask HN: your favorite mechanical keyboard?",
    url: null,
    by: "frank",
    score: 40,
    comments: 200,
    time: 1700000500,
  },
];

export const fakeHnClient: HnClient = {
  frontPage: () => Promise.resolve(CANNED),
};

// Marks a story relevant when its title contains any word (>= 3 chars) from the
// preferences text — predictable for tests, plausible for dev.
export const fakeAiFilter: AiFilter = {
  select: (prefs, stories) => {
    const words = prefs
      .toLowerCase()
      .split(/\s+/)
      .filter((word) => word.length >= 3);
    return Promise.resolve(
      stories.map((story) => {
        const title = story.title.toLowerCase();
        const relevant = words.some((word) => title.includes(word));
        return {
          id: story.id,
          relevant,
          score: relevant ? 80 : 0,
          reason: relevant ? "keyword match" : "",
        };
      }),
    );
  },
};
