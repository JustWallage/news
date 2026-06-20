import { z } from "zod";
import type { Story } from "../../shared/api";

// The external dependency seam for sending Telegram messages (the Bot API in
// production, a no-op fake elsewhere — see lib/deps.ts).
export interface TelegramClient {
  sendMessage(chatId: number, text: string): Promise<void>;
}

export function makeRealTelegramClient(token: string): TelegramClient {
  return {
    async sendMessage(chatId, text) {
      const res = await fetch(
        `https://api.telegram.org/bot${token}/sendMessage`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            chat_id: chatId,
            text,
            parse_mode: "HTML",
            disable_web_page_preview: true,
          }),
        },
      );
      if (!res.ok) {
        console.warn(`[telegram] sendMessage failed (${res.status})`);
      }
    },
  };
}

// Only the fields the bot reads from an incoming update; everything else (edits,
// callbacks, channel posts, …) is ignored.
export const updateSchema = z.object({
  message: z
    .object({
      chat: z.object({
        id: z.number(),
        username: z.string().optional(),
        first_name: z.string().optional(),
        last_name: z.string().optional(),
      }),
      text: z.string().optional(),
    })
    .optional(),
});
export type TelegramUpdate = z.infer<typeof updateSchema>;

const MAX_STORIES = 15;

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function itemLink(id: number): string {
  return `https://news.ycombinator.com/item?id=${id}`;
}

function userLink(by: string): string {
  return `https://news.ycombinator.com/user?id=${encodeURIComponent(by)}`;
}

function storyLink(story: Story): string {
  return story.url ?? itemLink(story.id);
}

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}

// Two lines per story: the clickable title, then a metadata line with the score
// and links to the poster's HN profile and the HN comments page.
function formatStory(s: Story): string {
  const title = `<a href="${storyLink(s)}">${escapeHtml(s.title)}</a>`;
  const meta = [
    plural(s.score, "point"),
    `by <a href="${userLink(s.by)}">${escapeHtml(s.by)}</a>`,
    `<a href="${itemLink(s.id)}">${plural(s.comments, "comment")}</a>`,
  ].join(" · ");
  return `${title}\n${meta}`;
}

// HTML message: each story as a title + metadata block (best matches first,
// capped), blocks separated by a blank line, then a link back to the app. Web
// previews are disabled by the client.
export function formatDigestMessage(stories: Story[], appUrl: string): string {
  const footer = `\n\n<a href="${appUrl}">Open the app</a>`;
  if (stories.length === 0) {
    return `No stories matched your interests today.${footer}`;
  }
  const shown = stories.slice(0, MAX_STORIES);
  const blocks = shown.map(formatStory);
  const extra = stories.length - shown.length;
  const tail = extra > 0 ? `\n\n…and ${extra} more` : "";
  return `🗞 ${stories.length} stories for you\n\n${blocks.join("\n\n")}${tail}${footer}`;
}
