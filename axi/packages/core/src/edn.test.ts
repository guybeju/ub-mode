import { describe, expect, it } from "vitest";
import { isEdnMap, Keyword, parseEdn, requireField } from "#src/edn";

describe("parseEdn", () => {
  it("reads the scalar forms the snapshots use", () => {
    expect(parseEdn("nil")).toBeNull();
    expect(parseEdn("true")).toBe(true);
    expect(parseEdn("false")).toBe(false);
    expect(parseEdn("42")).toBe(42);
    expect(parseEdn("-3")).toBe(-3);
    expect(parseEdn("31.284")).toBe(31.284);
    expect(parseEdn('"a \\"q\\" \\\\ \\n"')).toBe('a "q" \\ \n');
    expect(parseEdn(":survived")).toEqual(new Keyword("survived"));
    expect(parseEdn('"\\q"')).toBe("q");
    expect(parseEdn('"\\t\\r"')).toBe("\t\r");
    expect(parseEdn(" \n\t 7 ,")).toBe(7);
  });

  it("reads vectors and maps with commas as whitespace", () => {
    expect(parseEdn("[1, 2 3]")).toEqual([1, 2, 3]);
    expect(parseEdn('{:name "score", :end-line 7}')).toEqual({ name: "score", "end-line": 7 });
    expect(parseEdn('{"[\\"f\\",1]" :killed}')).toEqual({ '["f",1]': new Keyword("killed") });
  });

  it("reads a real crapper snapshot", () => {
    const text = `{:entries [
  {:name "score", :namespace "demo.board", :complexity 6, :coverage 11.1111, :crap 31.284}
  {:name "x", :namespace "demo.board", :complexity 1, :coverage nil, :crap nil}
]}
`;
    expect(parseEdn(text)).toEqual({
      entries: [
        { name: "score", namespace: "demo.board", complexity: 6, coverage: 11.1111, crap: 31.284 },
        { name: "x", namespace: "demo.board", complexity: 1, coverage: null, crap: null },
      ],
    });
  });

  it.each([
    ["", "unexpected end of input"],
    ["[1 2", "unexpected end of input"],
    ['"abc', "unterminated string"],
    ['"ab\\', "unterminated string"],
    ["{:a 1 :b}", "map has an odd number of forms"],
    ["1e999", "number out of range"],
    ["1x", "unsupported EDN form"],
    ["{:a}", "map has an odd number of forms"],
    ["1 2", "unexpected trailing input"],
    ["#{1}", "unsupported EDN form"],
    ["{[1] 2}", "map key must be a keyword or string"],
  ])("rejects %j with %s", (text, message) => {
    expect(() => parseEdn(text)).toThrow(message);
  });

  it("tells maps apart from every other form", () => {
    expect(isEdnMap(parseEdn("{:a 1}"))).toBe(true);
    for (const text of ["[1]", ":k", '"s"', "nil", "1", "true"]) {
      expect(isEdnMap(parseEdn(text))).toBe(false);
    }
    expect(isEdnMap(undefined)).toBe(false);
  });

  it("requires a field of the checked type", () => {
    const isNumber = (v: unknown): v is number => typeof v === "number";
    const missing = (key: string) => new Error(`no ${key}`);
    expect(requireField({ n: 1 }, "n", isNumber, missing)).toBe(1);
    expect(() => requireField({ n: "1" }, "n", isNumber, missing)).toThrow("no n");
    expect(() => requireField({}, "n", isNumber, missing)).toThrow("no n");
  });
});
