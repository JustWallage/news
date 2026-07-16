import type { AiFilter, StoryInput, Verdict } from "./digest";
import type { HnClient } from "./hn";
import { RssFetchError, type ParsedRssFeed, type RssClient } from "./rss";
import type { TelegramClient } from "./telegram";

// Deterministic stand-ins for the Algolia HN API + Workers AI, used in every
// environment except production (see lib/deps.ts). They make `pnpm dev` show
// realistic data and let e2e steer the feed purely through the preferences text.

// A few featured stories the e2e keyword tests rely on (titles contain the words
// the tests search for, e.g. "rust"/"bitcoin"). None of the filler titles below
// contain those words.
const FEATURED: StoryInput[] = [
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

// Filler so the fake front page is 100 stories — the same count we fetch from
// Algolia in one go. This makes the digest's multi-row upserts span many chunks
// against the real ephemeral D1 in CI e2e (D1 caps a query at 100 bound params).
const FILLER: StoryInput[] = Array.from({ length: 94 }, (_unused, i) => ({
  id: 2001 + i,
  title: `Sample front-page story ${i}`,
  url: `https://example.com/sample-${i}`,
  by: `user${i}`,
  score: 300 - i,
  comments: i,
  time: 1700001000 + i,
}));

const CANNED: StoryInput[] = [...FEATURED, ...FILLER];

export const fakeHnClient: HnClient = {
  frontPage: () => Promise.resolve(CANNED),
};

// No-op Telegram client for every environment without a bot token (local, e2e,
// unit). Tests that assert outgoing messages inject their own recording client.
export const fakeTelegramClient: TelegramClient = {
  sendMessage: (chatId) => {
    console.log(`[telegram] (fake) sendMessage to ${chatId}`);
    return Promise.resolve();
  },
};

// Marks an item relevant when its title contains any word (>= 3 chars) from the
// preferences text — predictable for tests, plausible for dev.
function keywordVerdicts(
  prefs: string,
  items: { id: number; title: string }[],
): Verdict[] {
  const words = prefs
    .toLowerCase()
    .split(/\s+/)
    .filter((word) => word.length >= 3);
  return items.map((item) => {
    const title = item.title.toLowerCase();
    const relevant = words.some((word) => title.includes(word));
    return {
      id: item.id,
      relevant,
      score: relevant ? 80 : 0,
    };
  });
}

export const fakeAiFilter: AiFilter = {
  select: (prefs, stories) => Promise.resolve(keywordVerdicts(prefs, stories)),
  selectFeedItems: (prefs, items) =>
    Promise.resolve(keywordVerdicts(prefs, items)),
};

// Canned RSS channel keyed off the source URL, so two sources in one feed yield
// distinct item links. The two featured titles carry the same e2e keywords as
// the fake HN stories; a URL containing "bad" fails like an unreachable feed.
export const fakeRssClient: RssClient = {
  fetch: (url) => {
    if (url.includes("bad")) {
      return Promise.reject(new RssFetchError("Could not reach that URL"));
    }
    const { hostname, origin } = new URL(url);
    const featured = [
      { title: "Rust in the kernel, one year in", slug: "rust" },
      { title: "Bitcoin custody for grandmothers", slug: "bitcoin" },
    ];
    const filler = Array.from({ length: 12 }, (_unused, i) => ({
      title: `Sample article ${i}`,
      slug: `sample-${i}`,
    }));
    const feed: ParsedRssFeed = {
      title: `Fake Feed (${hostname})`,
      items: [...featured, ...filler].map((item, i) => ({
        title: item.title,
        link: `${origin}/articles/${item.slug}`,
        publishedAt: new Date(Date.UTC(2026, 0, 1, 12, i)),
      })),
    };
    return Promise.resolve(feed);
  },
};
