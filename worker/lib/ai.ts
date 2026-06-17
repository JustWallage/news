import { z } from "zod";
import type { AiFilter, StoryInput, Verdict } from "./digest";

// Current latest Llama 70B on Workers AI.
const MODEL = "@cf/meta/llama-3.3-70b-instruct-fp8-fast";

// Batches keep each call small and let the model compare stories within a batch.
const BATCH_SIZE = 28;

const SYSTEM_PROMPT = [
  "You are a strict relevance filter for a personal Hacker News feed.",
  "You are given the user's interests and a numbered list of stories.",
  "Decide which stories clearly match the interests, judging from the title and",
  "the link's domain. When unsure, set relevant to false — exclude rather than",
  "include. Respond with ONLY a JSON object of the exact form",
  '{"stories":[{"id":<number>,"relevant":<boolean>,"score":<0-100>,"reason":"<short>"}]}',
  "with one entry per input story and no prose, code fences, or extra keys.",
].join(" ");

const verdictSchema = z.object({
  id: z.int(),
  relevant: z.boolean(),
  score: z.int().min(0).max(100).catch(0),
  reason: z.string().catch(""),
});
const outputSchema = z.object({ stories: z.array(verdictSchema) });

// Text models return { response: string }; be tolerant of an already-parsed
// object too.
const runResultSchema = z.object({
  response: z.union([z.string(), z.record(z.string(), z.unknown())]),
});

function domain(url: string | null): string {
  if (url === null) {
    return "self post";
  }
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "unknown";
  }
}

function buildUserPrompt(prefs: string, batch: StoryInput[]): string {
  const list = batch
    .map((s) => `- id ${s.id}: ${s.title} (${domain(s.url)})`)
    .join("\n");
  return `User interests:\n${prefs}\n\nStories:\n${list}`;
}

function extractJson(text: string): unknown {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end === -1 || end < start) {
    return null;
  }
  try {
    return JSON.parse(text.slice(start, end + 1));
  } catch {
    return null;
  }
}

function parseVerdicts(result: unknown): Verdict[] {
  const run = runResultSchema.safeParse(result);
  if (!run.success) {
    return [];
  }
  const payload =
    typeof run.data.response === "string"
      ? extractJson(run.data.response)
      : run.data.response;
  const parsed = outputSchema.safeParse(payload);
  return parsed.success ? parsed.data.stories : [];
}

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    out.push(items.slice(i, i + size));
  }
  return out;
}

export function makeRealAiFilter(ai: Ai): AiFilter {
  return {
    async select(prefs, inputs) {
      const verdicts: Verdict[] = [];
      for (const batch of chunk(inputs, BATCH_SIZE)) {
        const result = await ai.run(MODEL, {
          messages: [
            { role: "system", content: SYSTEM_PROMPT },
            { role: "user", content: buildUserPrompt(prefs, batch) },
          ],
        });
        verdicts.push(...parseVerdicts(result));
      }
      return verdicts;
    },
  };
}
