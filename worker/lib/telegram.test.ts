import { describe, expect, it } from "vitest";
import type { Story } from "../../shared/api";
import { formatDigestMessage } from "./telegram";

const APP = "https://news.justwallage.nl";

function story(over: Partial<Story> & { id: number; title: string }): Story {
  return {
    url: `https://e.com/${over.id}`,
    by: "alice",
    score: 100,
    comments: 10,
    time: "2026-06-17T06:20:00.000Z",
    relevanceScore: 80,
    reason: "",
    openedAt: null,
    ...over,
  };
}

describe("formatDigestMessage", () => {
  it("links each title and appends the app link", () => {
    const msg = formatDigestMessage(
      [story({ id: 1, title: "Rust rocks" })],
      APP,
    );
    expect(msg).toContain('<a href="https://e.com/1">Rust rocks</a>');
    expect(msg).toContain(`<a href="${APP}">Open the app</a>`);
  });

  it("shows score, a linked poster and a linked comment count, no bullet", () => {
    const msg = formatDigestMessage(
      [story({ id: 7, title: "Hi", by: "bob", score: 42, comments: 5 })],
      APP,
    );
    expect(msg).toContain("42 points");
    expect(msg).toContain(
      'by <a href="https://news.ycombinator.com/user?id=bob">bob</a>',
    );
    expect(msg).toContain(
      '<a href="https://news.ycombinator.com/item?id=7">5 comments</a>',
    );
    expect(msg).not.toContain("• ");
  });

  it("uses singular units for one point and one comment", () => {
    const msg = formatDigestMessage(
      [story({ id: 8, title: "Solo", score: 1, comments: 1 })],
      APP,
    );
    expect(msg).toContain("1 point ");
    expect(msg).toContain(">1 comment<");
  });

  it("separates consecutive stories with a blank line", () => {
    const msg = formatDigestMessage(
      [story({ id: 1, title: "One" }), story({ id: 2, title: "Two" })],
      APP,
    );
    expect(msg).toContain(
      '<a href="https://news.ycombinator.com/item?id=1">10 comments</a>\n\n<a href="https://e.com/2">Two</a>',
    );
  });

  it("escapes HTML in titles and links self-posts to the HN item", () => {
    const msg = formatDigestMessage(
      [story({ id: 5, title: "A < B & C", url: null })],
      APP,
    );
    expect(msg).toContain("A &lt; B &amp; C");
    expect(msg).toContain("https://news.ycombinator.com/item?id=5");
  });

  it("caps the list at 15 and notes the remainder", () => {
    const many = Array.from({ length: 20 }, (_unused, i) =>
      story({ id: i, title: `Story ${i}` }),
    );
    const msg = formatDigestMessage(many, APP);
    expect(msg.match(/<a href="https:\/\/e\.com/g)).toHaveLength(15);
    expect(msg).toContain("…and 5 more");
  });

  it("sends a friendly note on an empty day", () => {
    const msg = formatDigestMessage([], APP);
    expect(msg).toContain("No stories matched");
    expect(msg).toContain(`<a href="${APP}">Open the app</a>`);
  });
});
