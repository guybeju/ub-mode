import { describe, expect, it } from "vitest";
import { functionLabel, parseCrapSnapshot, rank, summarize, type CrapEntry } from "#src/crap";

const entry = (name: string, crap: number | null, coverage: number | null = 50): CrapEntry => ({
  name,
  namespace: "demo.board",
  complexity: 3,
  coverage,
  crap,
});

describe("parseCrapSnapshot", () => {
  it("reads entries including nil coverage", () => {
    const text = `{:entries [
  {:name "score", :namespace "demo.board", :complexity 6, :coverage 11.1111, :crap 31.284}
  {:name "x", :namespace "demo.board", :complexity 1, :coverage nil, :crap nil}
]}`;
    expect(parseCrapSnapshot(text)).toEqual([
      { name: "score", namespace: "demo.board", complexity: 6, coverage: 11.1111, crap: 31.284 },
      { name: "x", namespace: "demo.board", complexity: 1, coverage: null, crap: null },
    ]);
  });

  it("rejects a snapshot with the wrong shape", () => {
    expect(() => parseCrapSnapshot("{:rows []}")).toThrow("crap.edn has no :entries vector");
    expect(() => parseCrapSnapshot('{:entries [{:name "a"}]}')).toThrow(
      "crap.edn entry 0 is missing :namespace",
    );
    expect(() =>
      parseCrapSnapshot(
        '{:entries [{:name "a" :namespace "m" :complexity "3" :coverage nil :crap nil}]}',
      ),
    ).toThrow("crap.edn entry 0 is missing :complexity");
  });
});

describe("summarize", () => {
  it("fails the gate at the threshold itself, worst first, ungraded counted apart", () => {
    const summary = summarize(
      [entry("a", 9.99), entry("b", 10), entry("c", 31.3), entry("d", null, null)],
      10,
    );
    expect(summary.gate).toBe("fail");
    expect(summary.over.map((e) => e.name)).toEqual(["c", "b"]);
    expect(summary.total).toBe(4);
    expect(summary.ungraded).toBe(1);
  });

  it("passes when every graded function is under the threshold", () => {
    expect(summarize([entry("a", 2)], 10).gate).toBe("pass");
  });

  it("is ungraded when nothing has a CRAP score", () => {
    expect(summarize([entry("a", null, null)], 10).gate).toBe("ungraded");
    expect(summarize([], 10).gate).toBe("ungraded");
  });
});

describe("rank", () => {
  it("puts the worst first and ungraded last, or filters graded entries at a floor", () => {
    const entries = [entry("u", null, null), entry("low", 2), entry("high", 30), entry("ten", 10)];
    expect(rank(entries).map((e) => e.name)).toEqual(["high", "ten", "low", "u"]);
    expect(rank(entries, 10).map((e) => e.name)).toEqual(["high", "ten"]);
    expect(rank(entries, 0).map((e) => e.name)).toEqual(["high", "ten", "low"]);
  });
});

describe("functionLabel", () => {
  it("joins namespace and name in the language's style", () => {
    expect(functionLabel(entry("score", 1))).toBe("demo.board.score");
    expect(functionLabel({ ...entry("parse", 1), namespace: "crate::edn" })).toBe(
      "crate::edn::parse",
    );
    expect(functionLabel({ ...entry("Run", 1), namespace: "example.com/m/pkg" })).toBe(
      "example.com/m/pkg.Run",
    );
  });
});
