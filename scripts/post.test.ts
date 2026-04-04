import { describe, it, expect } from "vitest";
import { buildPostParts, graphemeLength } from "./post";

// Helper to create a mock Notion answer page
function makeAnswer(opts: {
  questionZh?: string;
  answerZh?: string;
  intendedJa?: string;
  dayNumber?: number;
  term?: number;
}) {
  return {
    properties: {
      "Answer (ZH)": {
        type: "rich_text",
        rich_text: [{ plain_text: opts.answerZh ?? "" }],
      },
      "Intended (JA)": {
        type: "rich_text",
        rich_text: [{ plain_text: opts.intendedJa ?? "" }],
      },
      "Day Number": {
        type: "number",
        number: opts.dayNumber ?? 1,
      },
      Term: {
        type: "number",
        number: opts.term ?? 1,
      },
      Question: {
        type: "relation",
        relation: opts.questionZh ? [{ id: "dummy" }] : [],
      },
    },
    _questionZh: opts.questionZh ?? "",
  };
}

describe("graphemeLength", () => {
  it("counts ASCII characters", () => {
    expect(graphemeLength("hello")).toBe(5);
  });

  it("counts CJK characters as 1 grapheme each", () => {
    expect(graphemeLength("日本語")).toBe(3);
  });

  it("counts emoji as 1 grapheme", () => {
    expect(graphemeLength("👨‍👩‍👧‍👦")).toBe(1);
  });
});

describe("buildPostParts", () => {
  it("returns single post when total is within 300 chars", () => {
    const answer = makeAnswer({
      questionZh: "你好",
      answerZh: "回答です",
      intendedJa: "短い文",
      dayNumber: 1,
    });

    const { main, reply } = buildPostParts(answer);
    expect(reply).toBeNull();
    expect(main).toContain("書きたかったこと:");
    expect(main).toContain("短い文");
    expect(main).toContain("#中国語3行日記");
  });

  it("splits into thread when exceeding 300 chars", () => {
    const longText = "あ".repeat(250);
    const answer = makeAnswer({
      questionZh: "你今天做了什么？",
      answerZh: "今天我去了超市买了很多东西。",
      intendedJa: longText,
      dayNumber: 50,
    });

    const { main, reply } = buildPostParts(answer);
    expect(reply).not.toBeNull();
    expect(main).toContain("質問:");
    expect(main).toContain("#中国語3行日記");
    expect(main).not.toContain("書きたかったこと:");
    expect(reply).toContain("書きたかったこと:");
    expect(reply).toContain(longText);
  });

  it("includes term suffix when term > 1", () => {
    const answer = makeAnswer({
      questionZh: "你好",
      answerZh: "短い",
      intendedJa: "短い",
      dayNumber: 5,
      term: 2,
    });

    const { main } = buildPostParts(answer);
    expect(main).toContain("#enoki_Day5_term2");
  });

  it("does not include term suffix when term is 1", () => {
    const answer = makeAnswer({
      questionZh: "你好",
      answerZh: "短い",
      intendedJa: "短い",
      dayNumber: 5,
      term: 1,
    });

    const { main } = buildPostParts(answer);
    expect(main).toContain("#enoki_Day5");
    expect(main).not.toContain("_term");
  });

  it("keeps main post within 300 chars when split", () => {
    const longText = "あ".repeat(250);
    const answer = makeAnswer({
      questionZh: "你今天做了什么？",
      answerZh: "今天我去了超市。",
      intendedJa: longText,
      dayNumber: 10,
    });

    const { main, reply } = buildPostParts(answer);
    expect(reply).not.toBeNull();
    expect(graphemeLength(main)).toBeLessThanOrEqual(300);
  });
});
