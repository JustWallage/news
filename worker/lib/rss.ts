import { parseFeed } from "feedsmith";
import { z } from "zod";
import { isHttpUrl } from "../../shared/api";

// User-supplied source URLs are fetched by the worker, so responses are capped
// before parsing (a hostile or misconfigured URL must not buffer unbounded XML).
const MAX_BODY_BYTES = 5 * 1024 * 1024;
const MAX_ITEMS_PER_SOURCE = 50;

export interface ParsedFeedItem {
  title: string;
  link: string;
  publishedAt: Date | null;
}

export interface ParsedRssFeed {
  title: string;
  items: ParsedFeedItem[];
}

/** The external dependency seam for fetching+parsing RSS sources. */
export interface RssClient {
  fetch(url: string): Promise<ParsedRssFeed>;
}

// Message is user-facing (surfaced by the add-source route), so keep it safe.
export class RssFetchError extends Error {}

// The three item shapes feedsmith can produce, reduced to the fields we keep:
// RSS 2.0 and RDF use `items[].link/pubDate`, Atom uses `entries[].links`,
// JSON Feed uses `items[].url/date_published`. Re-parsing with zod (rather than
// consuming feedsmith's own types) keeps this tolerant of partial feeds and free
// of casts.
const rssLikeSchema = z.object({
  title: z.string().optional(),
  items: z
    .array(
      z.object({
        title: z.string().optional(),
        link: z.string().optional(),
        pubDate: z.string().optional(),
      }),
    )
    .optional(),
});
const atomLikeSchema = z.object({
  title: z.string().optional(),
  entries: z
    .array(
      z.object({
        title: z.string().optional(),
        links: z
          .array(
            z.object({
              href: z.string().optional(),
              rel: z.string().optional(),
            }),
          )
          .optional(),
        published: z.string().optional(),
        updated: z.string().optional(),
      }),
    )
    .optional(),
});
const jsonLikeSchema = z.object({
  title: z.string().optional(),
  items: z
    .array(
      z.object({
        title: z.string().optional(),
        url: z.string().optional(),
        date_published: z.string().optional(),
      }),
    )
    .optional(),
});

interface RawItem {
  title: string | undefined;
  link: string | undefined;
  published: string | undefined;
}

function rawItems(
  format: string,
  feed: unknown,
): { title: string | undefined; items: RawItem[] } {
  if (format === "atom") {
    const atom = atomLikeSchema.safeParse(feed);
    if (!atom.success) {
      return { title: undefined, items: [] };
    }
    return {
      title: atom.data.title,
      items: (atom.data.entries ?? []).map((e) => ({
        title: e.title,
        link: (e.links?.find((l) => l.rel === "alternate") ?? e.links?.[0])
          ?.href,
        published: e.published ?? e.updated,
      })),
    };
  }
  if (format === "json") {
    const json = jsonLikeSchema.safeParse(feed);
    if (!json.success) {
      return { title: undefined, items: [] };
    }
    return {
      title: json.data.title,
      items: (json.data.items ?? []).map((i) => ({
        title: i.title,
        link: i.url,
        published: i.date_published,
      })),
    };
  }
  const rss = rssLikeSchema.safeParse(feed);
  if (!rss.success) {
    return { title: undefined, items: [] };
  }
  return {
    title: rss.data.title,
    items: (rss.data.items ?? []).map((i) => ({
      title: i.title,
      link: i.link,
      published: i.pubDate,
    })),
  };
}

function toDate(value: string | undefined): Date | null {
  if (value === undefined) {
    return null;
  }
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

// Parse a feed document into the normalized shape: channel title (hostname
// fallback) plus items with a non-empty title and an http(s) link, capped.
// Throws RssFetchError on anything unparseable. Exported for unit tests.
export function parseFeedXml(body: string, sourceUrl: string): ParsedRssFeed {
  let parsed: { format: string; feed: unknown };
  try {
    parsed = parseFeed(body);
  } catch {
    throw new RssFetchError("That URL is not a recognizable feed");
  }
  const { title, items } = rawItems(parsed.format, parsed.feed);
  const cleaned = items.flatMap((item) => {
    const itemTitle = item.title?.trim() ?? "";
    if (itemTitle === "" || item.link === undefined || !isHttpUrl(item.link)) {
      return [];
    }
    return [
      {
        title: itemTitle,
        link: item.link,
        publishedAt: toDate(item.published),
      },
    ];
  });
  const channelTitle = title?.trim() ?? "";
  return {
    title: channelTitle === "" ? new URL(sourceUrl).hostname : channelTitle,
    items: cleaned.slice(0, MAX_ITEMS_PER_SOURCE),
  };
}

export const realRssClient: RssClient = {
  async fetch(url) {
    let res: Response;
    try {
      res = await fetch(url, {
        headers: {
          Accept:
            "application/rss+xml, application/atom+xml, application/feed+json, application/xml;q=0.9, */*;q=0.8",
        },
      });
    } catch {
      throw new RssFetchError("Could not reach that URL");
    }
    if (!res.ok) {
      throw new RssFetchError(`That URL responded with ${String(res.status)}`);
    }
    const length = Number(res.headers.get("Content-Length") ?? "0");
    if (length > MAX_BODY_BYTES) {
      throw new RssFetchError("That feed is too large");
    }
    const body = await res.text();
    if (body.length > MAX_BODY_BYTES) {
      throw new RssFetchError("That feed is too large");
    }
    return parseFeedXml(body, url);
  },
};
