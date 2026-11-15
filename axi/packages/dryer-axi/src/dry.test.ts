import { describe, expect, it } from "vitest";
import { parseDrySnapshot, span, summarize, type Candidate } from "#src/dry";

const SNAPSHOT = `{:candidates [
 {:score 1.0
  :language "python"
  :left {:file "src/demo/board.py", :start-line 35, :end-line 40}
  :right {:file "src/demo/board.py", :start-line 43, :end-line 48}
  :left-nodes 105
  :right-nodes 105}
 {:score 0.674418604651
  :language "python"
  :left {:file "src/demo/board.py", :start-line 21, :end-line 25}
  :right {:file "src/demo/board.py", :start-line 28, :end-line 32}
  :left-nodes 66
  :right-nodes 66}
]}`;

const pair = (score: number): Candidate => ({
  score,
  language: "python",
  left: { file: "a.py", startLine: 1, endLine: 4 },
  right: { file: "b.py", startLine: 9, endLine: 12 },
});

describe("parseDrySnapshot", () => {
  it("reads candidates with both spans", () => {
    const [first] = parseDrySnapshot(SNAPSHOT);
    expect(first).toEqual({
      score: 1,
      language: "python",
      left: { file: "src/demo/board.py", startLine: 35, endLine: 40 },
      right: { file: "src/demo/board.py", startLine: 43, endLine: 48 },
    });
    expect(parseDrySnapshot("{:candidates []}")).toEqual([]);
  });

  it("rejects a malformed snapshot", () => {
    expect(() => parseDrySnapshot("{:entries []}")).toThrow("dry.edn has no :candidates vector");
    expect(() => parseDrySnapshot('{:candidates [{:score 1.0 :language "py"}]}')).toThrow(
      "dry.edn candidate 0 is missing :left",
    );
    const left = (span: string) =>
      `{:candidates [{:score 1.0 :language "py" :left ${span} :right {:file "b" :start-line 1 :end-line 2}}]}`;
    for (const bad of [
      "{:file 1 :start-line 1 :end-line 2}",
      '{:file "a" :start-line "1" :end-line 2}',
      '{:file "a" :start-line 1 :end-line nil}',
    ]) {
      expect(() => parseDrySnapshot(left(bad))).toThrow(
        "is missing :left :file/:start-line/:end-line",
      );
    }
  });
});

describe("summarize", () => {
  it("fails at the threshold itself and orders the closest pairs first", () => {
    const summary = summarize([pair(0.79), pair(0.8), pair(0.95)], 0.8);
    expect(summary.gate).toBe("fail");
    expect(summary.over.map((c) => c.score)).toEqual([0.95, 0.8]);
    expect(summary.total).toBe(3);
  });

  it("passes when no pair reaches the threshold, including an empty snapshot", () => {
    expect(summarize([pair(0.5)], 0.8).gate).toBe("pass");
    expect(summarize([], 0.8).gate).toBe("pass");
  });
});

describe("span", () => {
  it("prints file:start-end", () => {
    expect(span({ file: "src/a.py", startLine: 3, endLine: 13 })).toBe("src/a.py:3-13");
  });
});
