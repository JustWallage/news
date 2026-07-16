import { describe, expect, it } from "vitest";
import { RssFetchError, parseFeedXml } from "./rss";

const SOURCE = "https://blog.example.com/feed.xml";

function rss(items: string): string {
  return `<?xml version="1.0"?><rss version="2.0"><channel><title>My Blog</title>${items}</channel></rss>`;
}

describe("parseFeedXml", () => {
  it("parses an RSS 2.0 feed (title, link, pubDate)", () => {
    const feed = parseFeedXml(
      rss(
        `<item><title>Hello</title><link>https://blog.example.com/a</link><pubDate>Wed, 15 Jul 2026 10:00:00 GMT</pubDate></item>` +
          `<item><title>Undated</title><link>https://blog.example.com/b</link></item>`,
      ),
      SOURCE,
    );
    expect(feed.title).toBe("My Blog");
    expect(feed.items).toEqual([
      {
        title: "Hello",
        link: "https://blog.example.com/a",
        publishedAt: new Date("2026-07-15T10:00:00Z"),
      },
      {
        title: "Undated",
        link: "https://blog.example.com/b",
        publishedAt: null,
      },
    ]);
  });

  it("parses an Atom feed, preferring the alternate link", () => {
    const atom =
      `<?xml version="1.0"?><feed xmlns="http://www.w3.org/2005/Atom"><title>Atom Blog</title>` +
      `<entry><title>Entry</title>` +
      `<link href="https://blog.example.com/comments" rel="replies"/>` +
      `<link href="https://blog.example.com/entry" rel="alternate"/>` +
      `<published>2026-07-01T12:00:00Z</published></entry></feed>`;
    const feed = parseFeedXml(atom, SOURCE);
    expect(feed.title).toBe("Atom Blog");
    expect(feed.items).toEqual([
      {
        title: "Entry",
        link: "https://blog.example.com/entry",
        publishedAt: new Date("2026-07-01T12:00:00Z"),
      },
    ]);
  });

  it("drops titleless items and non-http(s) links", () => {
    const feed = parseFeedXml(
      rss(
        `<item><title></title><link>https://blog.example.com/no-title</link></item>` +
          `<item><title>Bad scheme</title><link>javascript:alert(1)</link></item>` +
          `<item><title>No link</title></item>` +
          `<item><title>Kept</title><link>https://blog.example.com/kept</link></item>`,
      ),
      SOURCE,
    );
    expect(feed.items.map((i) => i.title)).toEqual(["Kept"]);
  });

  it("caps a source at 50 items", () => {
    const many = Array.from(
      { length: 60 },
      (_unused, i) =>
        `<item><title>Item ${String(i)}</title><link>https://blog.example.com/${String(i)}</link></item>`,
    ).join("");
    const feed = parseFeedXml(rss(many), SOURCE);
    expect(feed.items).toHaveLength(50);
  });

  it("falls back to the source hostname when the channel has no title", () => {
    const feed = parseFeedXml(
      `<?xml version="1.0"?><rss version="2.0"><channel><item><title>X</title><link>https://blog.example.com/x</link></item></channel></rss>`,
      SOURCE,
    );
    expect(feed.title).toBe("blog.example.com");
  });

  it("throws RssFetchError on a document that is not a feed", () => {
    expect(() =>
      parseFeedXml("<html><body>nope</body></html>", SOURCE),
    ).toThrow(RssFetchError);
    expect(() => parseFeedXml("not xml at all", SOURCE)).toThrow(RssFetchError);
  });

  it("turns an unparseable date into null", () => {
    const feed = parseFeedXml(
      rss(
        `<item><title>Odd date</title><link>https://blog.example.com/d</link><pubDate>soonish</pubDate></item>`,
      ),
      SOURCE,
    );
    expect(feed.items[0]?.publishedAt).toBeNull();
  });
});
