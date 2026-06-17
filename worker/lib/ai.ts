import { z } from "zod";
import type { AiFilter, StoryInput, Verdict } from "./digest";

// Current latest Llama 70B on Workers AI.
const MODEL = "@cf/meta/llama-3.3-70b-instruct-fp8-fast";

// Smaller batches keep each JSON response well within max_tokens (a batch that
// overflows is truncated mid-object and won't parse).
const BATCH_SIZE = 20;
// Default Workers AI output is ~256 tokens — far too small for a batch of
// verdicts. 20 verdicts is well under this ceiling.
const MAX_TOKENS = 4096;

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

// Workers AI returns this model's output OpenAI-style (choices[].message.content);
// older/text models return { response: string | object }. Handle both.
const openAiSchema = z.object({
  choices: z.array(z.object({ message: z.object({ content: z.string() }) })),
});
const textSchema = z.object({
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

function parseJsonObject(text: string): unknown {
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

function extractPayload(result: unknown): unknown {
  const openai = openAiSchema.safeParse(result);
  if (openai.success) {
    const first = openai.data.choices[0];
    return first === undefined ? null : parseJsonObject(first.message.content);
  }
  const text = textSchema.safeParse(result);
  if (text.success) {
    return typeof text.data.response === "string"
      ? parseJsonObject(text.data.response)
      : text.data.response;
  }
  return null;
}

// Exported for tests: turns a raw Workers AI response into verdicts, tolerating
// the OpenAI envelope, the {response} envelope, and markdown/prose wrapping.
export function parseVerdicts(result: unknown): Verdict[] {
  const parsed = outputSchema.safeParse(extractPayload(result));
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
      // Batches run concurrently — order doesn't matter (results are keyed by id).
      const batches = await Promise.all(
        chunk(inputs, BATCH_SIZE).map(async (batch) => {
          const result = await ai.run(MODEL, {
            messages: [
              { role: "system", content: SYSTEM_PROMPT },
              { role: "user", content: buildUserPrompt(prefs, batch) },
            ],
            max_tokens: MAX_TOKENS,
          });
          const parsed = parseVerdicts(result);
          if (parsed.length === 0 && batch.length > 0) {
            console.warn(
              `[ai] parsed 0 of ${batch.length}; raw=${JSON.stringify(result).slice(0, 800)}`,
            );
          } else {
            console.log(
              `[ai] batch=${batch.length} parsed=${parsed.length} relevant=${parsed.filter((v) => v.relevant).length}`,
            );
          }
          return parsed;
        }),
      );
      return batches.flat();
    },
  };
}
