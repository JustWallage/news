import type { Bindings } from "../env";
import { makeRealAiFilter } from "./ai";
import type { AiFilter } from "./digest";
import { fakeAiFilter, fakeHnClient } from "./fakes";
import { realHnClient, type HnClient } from "./hn";

// THE single environment branch. Every handler (routes + the scheduled cron)
// receives its dependencies through `c.var.deps` / createDeps and is otherwise
// environment-agnostic — no `isTest`/ENVIRONMENT checks leak into the logic.
export interface Deps {
  hn: HnClient;
  ai: AiFilter;
}

export function createDeps(env: Bindings): Deps {
  const ai = env.AI;
  if (env.ENVIRONMENT === "e2e" || ai === undefined) {
    return { hn: fakeHnClient, ai: fakeAiFilter };
  }
  return { hn: realHnClient, ai: makeRealAiFilter(ai) };
}
