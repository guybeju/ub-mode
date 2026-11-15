import { runAxiCli, type AxiCliOptions } from "axi-sdk-js";
import { parseFlags, type FlagSpec } from "@ub-axi/core/flags";
import { readScopeDetails } from "@ub-axi/core/snapshot";
import {
  loadSnapshot,
  noSnapshot,
  runWrapped,
  snapshotHeader,
  wrappedCli,
  type CliDeps,
  type Output,
  type Wrapped,
} from "@ub-axi/core/wrapper";
import { parseDrySnapshot, span, summarize, type Candidate } from "#src/dry";
import { VERSION } from "#src/version";

const BIN = "dryer-axi";
const THRESHOLD = 0.8;
const HOME_LIMIT = 10;

const DRYER: Wrapped = {
  bin: BIN,
  tool: "dryer",
  envVar: "DRYER_AXI_TOOL",
  repo: "https://github.com/unclebob/dryer",
  snapshot: ".metrics/dry.edn",
  version: VERSION,
};

export type { CliDeps };

const RUN_SPEC: FlagSpec = {
  command: "run",
  bin: BIN,
  flags: {
    "--changed": { kind: "boolean" },
    "--threshold": { kind: "number" },
    "--min-lines": { kind: "number" },
  },
  positionals: "many",
};

const LIST_SPEC: FlagSpec = {
  command: "list",
  bin: BIN,
  flags: { "--threshold": { kind: "number" } },
  positionals: "none",
};

const HELP: Record<string, Output> = {
  run: {
    command: "run [paths..]",
    description: "Run dryer (structural duplicate detection) and summarize",
    flags: {
      "--changed": "only files with git additions or edits",
      "--threshold N": `minimum similarity to report, default ${THRESHOLD}; the gate stays at ${THRESHOLD}`,
      "--min-lines N": "minimum source lines in a candidate, default 4",
    },
    examples: [`${BIN} run`, `${BIN} run src/billing`, `${BIN} run --changed --min-lines 3`],
  },
  list: {
    command: "list",
    description: "List every candidate pair in the snapshot, closest first",
    flags: { "--threshold N": "only pairs at score >= N" },
    examples: [`${BIN} list`, `${BIN} list --threshold 0.9`],
  },
};

const TOP_HELP = `usage: ${BIN} [command] [flags]
commands:
  (none)  summarize .metrics/dry.edn and the similarity < ${THRESHOLD} gate
  run     run the analysis, then summarize
  list    list all candidate pairs closest first
`;

function pairRow(c: Candidate, withLanguage: boolean): Output {
  const row: Output = { score: Math.round(c.score * 100) / 100 };
  if (withLanguage) row["language"] = c.language;
  row["left"] = span(c.left);
  row["right"] = span(c.right);
  return row;
}

function summaryOutput(cwd: string, threshold: number): Output {
  const loaded = loadSnapshot(DRYER, cwd, parseDrySnapshot);
  if (!loaded) return noSnapshot(DRYER);
  const summary = summarize(loaded.value, threshold);
  const filteredAt = readScopeDetails(cwd, "dryer", loaded.mtimeMs)?.["threshold"];
  const gate =
    summary.gate === "pass" && !(filteredAt !== undefined && filteredAt <= threshold)
      ? "ungraded"
      : summary.gate;
  const { header, help } = snapshotHeader(DRYER, cwd, loaded.mtimeMs);
  if (header["scope"] === "unknown") {
    help.push(`Run \`${BIN} run\` so the snapshot uses the ${THRESHOLD} threshold`);
  }
  if (summary.over.length > 0) {
    help.push(`Run \`${BIN} run <path>\` after extracting the shared shape`);
  }
  help.push(`Run \`${BIN} list\` for all ${summary.total} pairs`);
  return {
    snapshot: header,
    gate,
    candidates: `${summary.over.length} at score >= ${threshold} of ${summary.total} in the snapshot`,
    pairs: summary.over.slice(0, HOME_LIMIT).map((c) => pairRow(c, false)),
    help,
  };
}

function list(deps: CliDeps, args: string[]): Output {
  const { cwd } = deps;
  const { flags } = parseFlags(args, LIST_SPEC);
  const loaded = loadSnapshot(DRYER, cwd, parseDrySnapshot);
  if (!loaded) return noSnapshot(DRYER);
  const floor = flags["--threshold"];
  const threshold = typeof floor === "number" ? floor : 0;
  const shown = summarize(loaded.value, threshold).over;
  if (shown.length === 0) {
    return { pairs: `0 of ${loaded.value.length} at score >= ${threshold}` };
  }
  return { pairs: shown.map((c) => pairRow(c, true)) };
}

async function run(deps: CliDeps, args: string[]): Promise<Output> {
  const { flags, positionals } = parseFlags(args, RUN_SPEC);
  const requested = flags["--threshold"];
  const threshold = typeof requested === "number" ? requested : THRESHOLD;
  const toolArgs = [...positionals];
  const notes: string[] = [];
  if (flags["--changed"]) {
    toolArgs.push("--changed");
    notes.push("(git changes)");
  }
  toolArgs.push("--threshold", String(threshold));
  notes.push(`(threshold ${threshold})`);
  const minLines = flags["--min-lines"];
  if (minLines !== undefined) {
    toolArgs.push("--min-lines", String(minLines));
    notes.push(`(min-lines ${minLines})`);
  }
  await runWrapped(DRYER, deps, {
    args: toolArgs,
    paths: positionals,
    notes,
    details: { threshold },
  });
  return summaryOutput(deps.cwd, THRESHOLD);
}

const DESCRIPTION = "Structural duplicate code candidates, gated at similarity < 0.8";

function home(deps: CliDeps): Output {
  return summaryOutput(deps.cwd, THRESHOLD);
}

const COMMANDS = { description: DESCRIPTION, topLevelHelp: TOP_HELP, help: HELP, home, run, list };

/** Builds the runtime options for `runAxiCli`, with the project directory and env injected. */
export function buildCli(deps: CliDeps): AxiCliOptions {
  return wrappedCli(DRYER, COMMANDS, deps);
}

export async function main(): Promise<void> {
  await runAxiCli(buildCli({ cwd: process.cwd(), env: process.env, progress: process.stderr }));
}
