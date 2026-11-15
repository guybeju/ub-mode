import { describe, expect, it } from "vitest";
import {
  functionName,
  parseMutateFile,
  positionAt,
  summarize,
  survivorsInOrder,
  uncoveredForms,
  type Form,
  type Outcome,
} from "#src/mutate";

const SNAPSHOT = `{:version 1 :tested-at "2026-11-16T01:35:26+08:00" :source "src/demo/board.py"
 :namespace "demo.board"
 :outcomes {"[\\"src/demo/board.py\\",\\"demo.board\\",\\"defn/place\\",33,34,\\"<\\",\\"<=\\"]" :survived
            "[\\"src/demo/board.py\\",\\"demo.board\\",\\"defn/alpha\\",429,430,\\"+\\",\\"-\\"]" :killed}
 :forms [{:id "defn/place" :kind "defn" :file "src/demo/board.py" :line 1 :end-line 7 :hash "h"
          :killed 3 :survived 6 :uncovered 0 :sites 9}
         {:id "defn-/_hide" :kind "defn-" :file "src/demo/board.py" :line 9 :end-line 10 :hash "h"
          :killed 0 :survived 0 :uncovered 2 :sites 2}]}`;

const form = (killed: number, survived: number, uncovered: number): Form => ({
  id: "defn/f",
  namespace: "m",
  file: "a.py",
  line: 1,
  endLine: 2,
  killed,
  survived,
  uncovered,
});

describe("parseMutateFile", () => {
  it("reads forms and decodes each outcome key", () => {
    const parsed = parseMutateFile(SNAPSHOT);
    expect(parsed.forms).toHaveLength(2);
    expect(parsed.forms[0]).toEqual({
      id: "defn/place",
      namespace: "demo.board",
      file: "src/demo/board.py",
      line: 1,
      endLine: 7,
      killed: 3,
      survived: 6,
      uncovered: 0,
    });
    expect(parsed.outcomes).toEqual([
      {
        file: "src/demo/board.py",
        formId: "defn/place",
        namespace: "demo.board",
        start: 33,
        from: "<",
        to: "<=",
        status: "survived",
      },
      {
        file: "src/demo/board.py",
        formId: "defn/alpha",
        namespace: "demo.board",
        start: 429,
        from: "+",
        to: "-",
        status: "killed",
      },
    ]);
  });

  it("rejects malformed snapshots and outcome keys", () => {
    expect(() => parseMutateFile('{:namespace "m"}')).toThrow("has no :forms vector");
    expect(() => parseMutateFile('{:namespace "m" :forms [] :outcomes {"x" :killed}}')).toThrow(
      "outcome key is not a mutation: x",
    );
    for (const key of [
      '["f","m","d/x","1",2,"a","b"]',
      '["f","m","d/x",1,"2","a","b"]',
      '["f","m","d/x",1,2,"a"]',
    ]) {
      const text = `{:namespace "m" :forms [] :outcomes {${JSON.stringify(key)} :killed}}`;
      expect(() => parseMutateFile(text)).toThrow("outcome key is not a mutation");
    }
  });

  it("ignores outcomes whose status is not a killed or survived keyword", () => {
    const key = JSON.stringify('["f","m","defn/x",1,2,"a","b"]');
    for (const status of ['"survived"', ":uncovered"]) {
      expect(
        parseMutateFile(`{:namespace "m" :forms [] :outcomes {${key} ${status}}}`).outcomes,
      ).toEqual([]);
    }
  });
});

describe("summarize", () => {
  it("fails on any survivor", () => {
    expect(summarize([form(3, 1, 0), form(2, 0, 4)])).toEqual({
      gate: "fail",
      killed: 5,
      survived: 1,
      uncovered: 4,
    });
  });

  it("passes when mutants ran and all were killed", () => {
    expect(summarize([form(2, 0, 1)]).gate).toBe("pass");
  });

  it("is ungraded when no mutant ran", () => {
    expect(summarize([form(0, 0, 3)]).gate).toBe("ungraded");
    expect(summarize([]).gate).toBe("ungraded");
  });
});

const outcome = (file: string, start: number, status: Outcome["status"]): Outcome => ({
  file,
  namespace: "m",
  formId: "defn/f",
  start,
  from: "<",
  to: "<=",
  status,
});

describe("survivorsInOrder", () => {
  it("keeps survivors only, ordered by file then position", () => {
    const ordered = survivorsInOrder([
      outcome("b.py", 5, "survived"),
      outcome("a.py", 9, "survived"),
      outcome("a.py", 3, "survived"),
      outcome("a.py", 1, "killed"),
    ]);
    expect(ordered.map((o) => `${o.file}@${o.start}`)).toEqual(["a.py@3", "a.py@9", "b.py@5"]);
  });
});

describe("uncoveredForms", () => {
  it("keeps forms with any uncovered site, most first", () => {
    const forms = [form(1, 0, 1), form(1, 0, 0), form(1, 0, 3)];
    expect(uncoveredForms(forms).map((f) => f.uncovered)).toEqual([3, 1]);
  });
});

describe("functionName", () => {
  it("drops the form kind and marks private forms", () => {
    expect(functionName("demo.board", "defn/place")).toBe("demo.board.place");
    expect(functionName("demo.board", "defn-/_hide")).toBe("demo.board._hide (private)");
  });
});

describe("positionAt", () => {
  it("maps a UTF-8 byte offset to its 1-based line and character column", () => {
    const bytes = Buffer.from("a\né = 1\nx\n", "utf8");
    expect(positionAt(bytes, 0)).toEqual({ line: 1, column: 1 });
    expect(positionAt(bytes, 2)).toEqual({ line: 2, column: 1 });
    expect(positionAt(bytes, 5)).toEqual({ line: 2, column: 3 });
    expect(positionAt(bytes, 9)).toEqual({ line: 3, column: 1 });
    expect(positionAt(Buffer.from("abc"), 2)).toEqual({ line: 1, column: 3 });
    expect(positionAt(Buffer.from("\nx"), 1)).toEqual({ line: 2, column: 1 });
    expect(positionAt(Buffer.from("a\nb"), 1)).toEqual({ line: 1, column: 2 });
  });
});
