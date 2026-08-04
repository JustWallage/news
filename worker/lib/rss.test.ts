import { describe, expect, it } from "vitest";
import { RssFetchError, parseFeedXml, readBodyCapped } from "./rss";

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

  it("keeps the newest items when capping an oldest-first feed", () => {
    const many = Array.from(
      { length: 60 },
      (_unused, i) =>
        `<item><title>Item ${String(i)}</title><link>https://blog.example.com/${String(i)}</link>` +
        `<pubDate>${new Date(Date.UTC(2026, 0, 1 + i)).toUTCString()}</pubDate></item>`,
    ).join("");
    const feed = parseFeedXml(rss(many), SOURCE);
    expect(feed.items).toHaveLength(50);
    expect(feed.items[0]?.title).toBe("Item 59");
    expect(feed.items.some((i) => i.title === "Item 5")).toBe(false);
  });

  it("reduces an RSS description to plain text, minus the WordPress tail", () => {
    const feed = parseFeedXml(
      rss(
        `<item><title>Funded</title><link>https://blog.example.com/f</link>` +
          `<description><![CDATA[<p>A Rotterdam startup raised &euro;2M &amp; hired.</p>` +
          `<p>The post <a href="https://x.test/f">Funded</a> appeared first on <a href="https://x.test">Site</a>.</p>]]></description>` +
          `</item>`,
      ),
      SOURCE,
    );
    expect(feed.items[0]?.summary).toBe(
      "A Rotterdam startup raised &euro;2M & hired.",
    );
  });

  it("falls back to content:encoded when there is no description", () => {
    const feed = parseFeedXml(
      `<?xml version="1.0"?><rss version="2.0" xmlns:content="http://purl.org/rss/1.0/modules/content/">` +
        `<channel><title>My Blog</title><item><title>Body only</title>` +
        `<link>https://blog.example.com/c</link>` +
        `<content:encoded><![CDATA[<p>The whole article body.</p>]]></content:encoded>` +
        `</item></channel></rss>`,
      SOURCE,
    );
    expect(feed.items[0]?.summary).toBe("The whole article body.");
  });

  it("leaves the summary undefined when the item publishes none", () => {
    const feed = parseFeedXml(
      rss(
        `<item><title>Bare</title><link>https://blog.example.com/b</link></item>`,
      ),
      SOURCE,
    );
    expect(feed.items).toHaveLength(1);
    expect(feed.items[0]?.summary).toBeUndefined();
  });

  it("truncates a long summary to 300 characters", () => {
    const feed = parseFeedXml(
      rss(
        `<item><title>Long</title><link>https://blog.example.com/l</link>` +
          `<description>${"a".repeat(900)}</description></item>`,
      ),
      SOURCE,
    );
    expect(feed.items[0]?.summary).toHaveLength(300);
  });

  it("takes the Atom summary, falling back to content", () => {
    const entry = (body: string): string =>
      `<?xml version="1.0"?><feed xmlns="http://www.w3.org/2005/Atom"><title>Atom Blog</title>` +
      `<entry><title>Entry</title><link href="https://blog.example.com/e" rel="alternate"/>${body}</entry></feed>`;
    expect(
      parseFeedXml(
        entry(`<summary>Short take.</summary><content>Full body.</content>`),
        SOURCE,
      ).items[0]?.summary,
    ).toBe("Short take.");
    expect(
      parseFeedXml(entry(`<content>Full body.</content>`), SOURCE).items[0]
        ?.summary,
    ).toBe("Full body.");
  });

  it("takes the JSON Feed summary, falling back to content_html", () => {
    const json = (item: Record<string, string>): string =>
      JSON.stringify({
        version: "https://jsonfeed.org/version/1.1",
        title: "JSON Blog",
        items: [{ id: "1", url: "https://blog.example.com/j", ...item }],
      });
    expect(
      parseFeedXml(
        json({
          title: "J",
          summary: "Summary line.",
          content_html: "<p>Body</p>",
        }),
        SOURCE,
      ).items[0]?.summary,
    ).toBe("Summary line.");
    expect(
      parseFeedXml(json({ title: "J", content_html: "<p>Body</p>" }), SOURCE)
        .items[0]?.summary,
    ).toBe("Body");
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

describe("readBodyCapped", () => {
  function chunkedResponse(chunks: string[]): Response {
    const encoder = new TextEncoder();
    return new Response(
      new ReadableStream({
        start(controller) {
          for (const chunk of chunks) {
            controller.enqueue(encoder.encode(chunk));
          }
          controller.close();
        },
      }),
    );
  }

  it("returns the full body when under the cap", async () => {
    const body = await readBodyCapped(
      chunkedResponse(["<rss>", "</rss>"]),
      100,
    );
    expect(body).toBe("<rss></rss>");
  });

  it("aborts mid-stream as soon as the cap is exceeded", async () => {
    // No Content-Length here (chunked stream) — the cap must fire anyway,
    // before the whole body is buffered.
    const chunks = Array.from({ length: 10 }, () => "x".repeat(64));
    await expect(readBodyCapped(chunkedResponse(chunks), 200)).rejects.toThrow(
      RssFetchError,
    );
  });
});
