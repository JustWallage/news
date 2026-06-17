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
      chat: z.object({ id: z.number() }),
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

function storyLink(story: Story): string {
  return story.url ?? `https://news.ycombinator.com/item?id=${story.id}`;
}

// HTML message: one clickable title per line (best matches first, capped), then
// a link back to the app. Web previews are disabled by the client.
export function formatDigestMessage(stories: Story[], appUrl: string): string {
  const footer = `\n\n<a href="${appUrl}">Open the app</a>`;
  if (stories.length === 0) {
    return `No stories matched your interests today.${footer}`;
  }
  const shown = stories.slice(0, MAX_STORIES);
  const lines = shown.map(
    (s) => `• <a href="${storyLink(s)}">${escapeHtml(s.title)}</a>`,
  );
  const extra = stories.length - shown.length;
  const tail = extra > 0 ? `\n…and ${extra} more` : "";
  return `🗞 ${stories.length} stories for you\n\n${lines.join("\n")}${tail}${footer}`;
}
