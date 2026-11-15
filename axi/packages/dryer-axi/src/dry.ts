import { isEdnMap, parseEdn, type Edn, type EdnMap } from "@ub-axi/core/edn";

export interface Span {
  file: string;
  startLine: number;
  endLine: number;
}

export interface Candidate {
  score: number;
  language: string;
  left: Span;
  right: Span;
}

export interface DrySummary {
  gate: "pass" | "fail";
  total: number;
  over: Candidate[];
}

function missing(index: number, key: string): Error {
  return new Error(`dry.edn candidate ${index} is missing :${key}`);
}

function readSpan(row: EdnMap, key: string, index: number): Span {
  const value = row[key];
  if (!isEdnMap(value)) throw missing(index, key);
  const { file, "start-line": startLine, "end-line": endLine } = value;
  if (typeof file !== "string" || typeof startLine !== "number" || typeof endLine !== "number") {
    throw missing(index, `${key} :file/:start-line/:end-line`);
  }
  return { file, startLine, endLine };
}

function readCandidate(row: Edn, index: number): Candidate {
  if (!isEdnMap(row)) throw new Error(`dry.edn candidate ${index} is not a map`);
  const { score, language } = row;
  if (typeof score !== "number") throw missing(index, "score");
  if (typeof language !== "string") throw missing(index, "language");
  return {
    score,
    language,
    left: readSpan(row, "left", index),
    right: readSpan(row, "right", index),
  };
}

/** Parses `.metrics/dry.edn` into duplicate candidates. */
export function parseDrySnapshot(text: string): Candidate[] {
  const root = parseEdn(text);
  const rows = isEdnMap(root) ? root["candidates"] : undefined;
  if (!Array.isArray(rows)) throw new Error("dry.edn has no :candidates vector");
  return rows.map(readCandidate);
}

/** Applies the ub-mode gate: no candidate pair may score at or above `threshold`. */
export function summarize(candidates: Candidate[], threshold: number): DrySummary {
  const over = candidates.filter((c) => c.score >= threshold).sort((a, b) => b.score - a.score);
  return { gate: over.length > 0 ? "fail" : "pass", total: candidates.length, over };
}

export function span(s: Span): string {
  return `${s.file}:${s.startLine}-${s.endLine}`;
}
