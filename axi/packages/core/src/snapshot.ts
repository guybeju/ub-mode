import { mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { extname, join } from "node:path";

const SOURCE_EXTENSIONS = new Set([
  ".clj",
  ".cljc",
  ".cljs",
  ".bb",
  ".java",
  ".go",
  ".ts",
  ".tsx",
  ".mts",
  ".cts",
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
  ".rs",
  ".py",
]);

// The wrapped tools' own skip list, so "newer" counts only what they analyze.
const SKIP_DIRS = new Set([
  ".git",
  ".hg",
  ".svn",
  ".idea",
  ".venv",
  "venv",
  "node_modules",
  "vendor",
  "target",
  "dist",
  "build",
  "out",
  "coverage",
  ".metrics",
  "testdata",
  "__pycache__",
  ".clj-kondo",
]);

export interface Snapshot {
  text: string;
  mtimeMs: number;
}

function isMissing(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}

/** Reads a snapshot file relative to the project root, or null when it does not exist. */
export function readSnapshot(root: string, relativePath: string): Snapshot | null {
  const path = join(root, relativePath);
  try {
    return { text: readFileSync(path, "utf8"), mtimeMs: statSync(path).mtimeMs };
  } catch (error) {
    if (isMissing(error)) return null;
    throw error;
  }
}

/** Counts analyzable source files modified after `sinceMs`. */
export function countNewerSources(root: string, sinceMs: number): number {
  let count = 0;
  const pending = [root];
  for (let dir = pending.pop(); dir !== undefined; dir = pending.pop()) {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (!SKIP_DIRS.has(entry.name)) pending.push(path);
      } else if (SOURCE_EXTENSIONS.has(extname(entry.name)) && statSync(path).mtimeMs > sinceMs) {
        count += 1;
      }
    }
  }
  return count;
}

function scopePath(root: string, tool: string): string {
  return join(root, ".metrics", "axi", `${tool}.json`);
}

export interface ScopeRun {
  paths: string[];
  notes?: string[];
  details?: Record<string, number>;
}

/**
 * Records which run produced the snapshot whose mtime is `snapshotMtimeMs`.
 * An empty path list means the whole project; `notes` qualify the run, e.g. "(git changes)";
 * `details` hold values a home view computes with, e.g. the threshold a snapshot was filtered at.
 */
export function writeScope(
  root: string,
  tool: string,
  run: ScopeRun,
  snapshotMtimeMs: number,
): void {
  mkdirSync(join(root, ".metrics", "axi"), { recursive: true });
  const record = { paths: run.paths, notes: run.notes, details: run.details, snapshotMtimeMs };
  writeFileSync(scopePath(root, tool), `${JSON.stringify(record)}\n`);
}

function stringList(value: unknown): string[] | null {
  return Array.isArray(value) && value.every((v) => typeof v === "string") ? value : null;
}

function numberMap(value: unknown): Record<string, number> {
  if (typeof value !== "object" || value === null) return {};
  const entries = Object.entries(value).filter(([, v]) => typeof v === "number");
  return Object.fromEntries(entries) as Record<string, number>;
}

function readRecord(
  root: string,
  tool: string,
  snapshotMtimeMs: number,
): Required<ScopeRun> | null {
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(scopePath(root, tool), "utf8"));
  } catch {
    return null;
  }
  if (typeof raw !== "object" || raw === null) return null;
  const record = raw as {
    paths?: unknown;
    notes?: unknown;
    details?: unknown;
    snapshotMtimeMs?: unknown;
  };
  const paths = stringList(record.paths);
  if (record.snapshotMtimeMs !== snapshotMtimeMs || paths === null) return null;
  return {
    paths,
    notes: Array.isArray(record.notes) ? record.notes.filter((n) => typeof n === "string") : [],
    details: numberMap(record.details),
  };
}

/** Describes the scope of the current snapshot, or "unknown" if no record matches it. */
export function readScope(root: string, tool: string, snapshotMtimeMs: number): string {
  const record = readRecord(root, tool, snapshotMtimeMs);
  if (!record) return "unknown";
  const where = record.paths.length === 0 ? "whole project" : record.paths.join(" ");
  return [where, ...record.notes].join(" ");
}

/** The details recorded with the run that produced the current snapshot, or null. */
export function readScopeDetails(
  root: string,
  tool: string,
  snapshotMtimeMs: number,
): Record<string, number> | null {
  const record = readRecord(root, tool, snapshotMtimeMs);
  return record ? record.details : null;
}
