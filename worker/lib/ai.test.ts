import { describe, expect, it } from "vitest";
import { parseRelevant, verdictsFor } from "./ai";
import type { StoryInput } from "./digest";

// The shape Workers AI actually returns for llama-3.1-8b-instruct-fp8-fast.
function openai(content: string): unknown {
  return { choices: [{ message: { content } }] };
}

const RELEVANT = '{"relevant":[{"id":1,"score":80},{"id":3,"score":55}]}';

describe("parseRelevant", () => {
  it("parses the OpenAI choices[].message.content envelope", () => {
    expect(parseRelevant(openai(RELEVANT))?.map((h) => h.id)).toEqual([1, 3]);
  });

  it("tolerates prose / markdown fences around the JSON", () => {
    expect(
      parseRelevant(
        openai("Sure! Here is the JSON:\n```json\n" + RELEVANT + "\n```"),
      ),
    ).toHaveLength(2);
  });

  it("parses the legacy { response: string } envelope", () => {
    expect(parseRelevant({ response: RELEVANT })).toHaveLength(2);
  });

  it("returns an empty list (not null) when nothing matched", () => {
    expect(parseRelevant(openai('{"relevant":[]}'))).toEqual([]);
  });

  it("returns null on a truncated (finish_reason=length) response", () => {
    expect(
      parseRelevant(openai('{"relevant":[{"id":5,"score":80,')),
    ).toBeNull();
  });

  it("returns null on an unrecognized shape", () => {
    expect(parseRelevant({ unexpected: true })).toBeNull();
  });
});

function story(id: number): StoryInput {
  return {
    id,
    title: `t${id}`,
    url: null,
    by: "a",
    score: 1,
    comments: 0,
    time: 0,
  };
}

describe("verdictsFor", () => {
  it("marks listed stories relevant and every other story not-relevant", () => {
    expect(
      verdictsFor(
        [story(1), story(2), story(3)],
        [
          { id: 1, score: 80 },
          { id: 3, score: 55 },
        ],
      ),
    ).toEqual([
      { id: 1, relevant: true, score: 80 },
      { id: 2, relevant: false, score: 0 },
      { id: 3, relevant: true, score: 55 },
    ]);
  });

  it("judges the whole batch not-relevant on an empty hit list", () => {
    expect(
      verdictsFor([story(1), story(2)], []).every((v) => !v.relevant),
    ).toBe(true);
  });
});
