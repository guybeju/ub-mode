import { isEdnMap as isMap, parseEdn, requireField, type Edn, type EdnMap } from "@ub-axi/core/edn";

export interface CrapEntry {
  name: string;
  namespace: string;
  complexity: number;
  coverage: number | null;
  crap: number | null;
}

export type Gate = "pass" | "fail" | "ungraded";

export interface CrapSummary {
  gate: Gate;
  total: number;
  ungraded: number;
  over: CrapEntry[];
}

function field<T extends Edn>(
  row: EdnMap,
  key: string,
  index: number,
  check: (v: Edn | undefined) => v is T,
): T {
  return requireField(
    row,
    key,
    check,
    (k) => new Error(`crap.edn entry ${index} is missing :${k}`),
  );
}

const isString = (v: Edn | undefined): v is string => typeof v === "string";
const isNumber = (v: Edn | undefined): v is number => typeof v === "number";
const isNumberOrNil = (v: Edn | undefined): v is number | null =>
  v === null || typeof v === "number";

/** Parses `.metrics/crap.edn` into entries, rejecting any row that lacks a required field. */
export function parseCrapSnapshot(text: string): CrapEntry[] {
  const root = parseEdn(text);
  const rows = isMap(root) ? root["entries"] : undefined;
  if (!Array.isArray(rows)) {
    throw new Error("crap.edn has no :entries vector");
  }
  return rows.map((row, index) => {
    if (!isMap(row)) throw new Error(`crap.edn entry ${index} is not a map`);
    return {
      name: field(row, "name", index, isString),
      namespace: field(row, "namespace", index, isString),
      complexity: field(row, "complexity", index, isNumber),
      coverage: field(row, "coverage", index, isNumberOrNil),
      crap: field(row, "crap", index, isNumberOrNil),
    };
  });
}

type Graded = CrapEntry & { crap: number };

const isGraded = (e: CrapEntry): e is Graded => e.crap !== null;

/**
 * Orders entries worst CRAP first, ungraded last. With `atLeast`, keeps only graded
 * entries scoring at or above it.
 */
export function rank(entries: CrapEntry[], atLeast?: number): CrapEntry[] {
  const graded = entries.filter(isGraded).sort((a, b) => b.crap - a.crap);
  if (atLeast !== undefined) return graded.filter((e) => e.crap >= atLeast);
  return [...graded, ...entries.filter((e) => !isGraded(e))];
}

/**
 * Applies the ub-mode gate: every function must score under `threshold`.
 * Entries without a CRAP score (a run without coverage) are counted but not graded.
 */
export function summarize(entries: CrapEntry[], threshold: number): CrapSummary {
  const graded = entries.filter(isGraded).length;
  const over = rank(entries, threshold);
  let gate: Gate = "pass";
  if (graded === 0) gate = "ungraded";
  else if (over.length > 0) gate = "fail";
  return { gate, total: entries.length, ungraded: entries.length - graded, over };
}

/** Names a function the way its language does: `crate::mod::f` for Rust, dotted otherwise. */
export function functionLabel(entry: CrapEntry): string {
  const separator = entry.namespace.includes("::") ? "::" : ".";
  return `${entry.namespace}${separator}${entry.name}`;
}
