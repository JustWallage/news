import type { Bindings } from "../env";
import { makeRealAiFilter } from "./ai";
import type { AiFilter } from "./digest";
import {
  fakeAiFilter,
  fakeHnClient,
  fakeRssClient,
  fakeTelegramClient,
} from "./fakes";
import { realHnClient, type HnClient } from "./hn";
import { realRssClient, type RssClient } from "./rss";
import { makeRealTelegramClient, type TelegramClient } from "./telegram";

// THE single environment branch. Every handler (routes + the scheduled cron)
// receives its dependencies through `c.var.deps` / createDeps and is otherwise
// environment-agnostic — no `isTest`/ENVIRONMENT checks leak into the logic.
export interface Deps {
  hn: HnClient;
  ai: AiFilter;
  rss: RssClient;
  telegram: TelegramClient;
}

export function createDeps(env: Bindings): Deps {
  const ai = env.AI;
  const hnAi =
    env.ENVIRONMENT === "e2e" || ai === undefined
      ? { hn: fakeHnClient, ai: fakeAiFilter, rss: fakeRssClient }
      : { hn: realHnClient, ai: makeRealAiFilter(ai), rss: realRssClient };
  // Telegram is wired independently: real only when the bot token is set.
  const token = env.TELEGRAM_BOT_TOKEN;
  const telegram =
    token === undefined || token === ""
      ? fakeTelegramClient
      : makeRealTelegramClient(token);
  return { ...hnAi, telegram };
}
