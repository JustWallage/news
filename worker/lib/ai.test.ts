import { describe, expect, it } from "vitest";
import { parseVerdicts } from "./ai";

// The shape Workers AI actually returns for llama-3.3-70b-instruct-fp8-fast.
function openai(content: string): unknown {
  return { choices: [{ message: { content } }] };
}

const STORIES =
  '{"stories":[{"id":1,"relevant":true,"score":80,"reason":"match"},{"id":2,"relevant":false,"score":0,"reason":"no"}]}';

describe("parseVerdicts", () => {
  it("parses the OpenAI choices[].message.content envelope", () => {
    const verdicts = parseVerdicts(openai(STORIES));
    expect(verdicts.map((v) => v.id)).toEqual([1, 2]);
    expect(verdicts.filter((v) => v.relevant).map((v) => v.id)).toEqual([1]);
  });

  it("tolerates prose / markdown fences around the JSON", () => {
    const verdicts = parseVerdicts(
      openai("Sure! Here is the JSON:\n```json\n" + STORIES + "\n```"),
    );
    expect(verdicts).toHaveLength(2);
  });

  it("parses the legacy { response: string } envelope", () => {
    expect(parseVerdicts({ response: STORIES })).toHaveLength(2);
  });

  it("returns [] on a truncated (finish_reason=length) response", () => {
    const verdicts = parseVerdicts(
      openai('{"stories":[{"id":5,"relevant":true,"score":80,'),
    );
    expect(verdicts).toEqual([]);
  });

  it("returns [] on an unrecognized shape", () => {
    expect(parseVerdicts({ unexpected: true })).toEqual([]);
  });
});
