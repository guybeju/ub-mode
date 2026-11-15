import { AxiError, runAxiCli, type AxiCliOptions } from "axi-sdk-js";
import { parseFlags, type FlagSpec } from "@ub-axi/core/flags";
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
import { functionLabel, parseCrapSnapshot, rank, summarize, type CrapEntry } from "#src/crap";
import { VERSION } from "#src/version";

const BIN = "crapper-axi";
const THRESHOLD = 10;
const HOME_LIMIT = 10;
const EXTRA_FIELDS = ["complexity"] as const;
const NO_COVERAGE =
  "every function shows 0% coverage: the tests or coverage step likely did not run; " +
  "the nearest package.json needs a test or coverage script writing LCOV under coverage/";

const CRAPPER: Wrapped = {
  bin: BIN,
  tool: "crapper",
  envVar: "CRAPPER_AXI_TOOL",
  repo: "https://github.com/unclebob/crapper",
  snapshot: ".metrics/crap.edn",
  version: VERSION,
};

export type { CliDeps };

const RUN_SPEC: FlagSpec = {
  command: "run",
  bin: BIN,
  flags: {
    "--changed": { kind: "boolean" },
    "--no-coverage": { kind: "boolean" },
    "--threshold": { kind: "number" },
  },
  positionals: "many",
};

const LIST_SPEC: FlagSpec = {
  command: "list",
  bin: BIN,
  flags: { "--over": { kind: "number" }, "--fields": { kind: "string" } },
  positionals: "none",
};

const HELP: Record<string, Output> = {
  run: {
    command: "run [paths..]",
    description: "Run crapper (complexity, coverage via the project's tests) and summarize",
    flags: {
      "--changed": "only files with git additions or edits",
      "--no-coverage": "complexity only; CRAP is ungraded",
      "--threshold N": `gate threshold, default ${THRESHOLD} (fails at >= N)`,
    },
    examples: [`${BIN} run`, `${BIN} run src/billing`, `${BIN} run --changed`],
  },
  list: {
    command: "list",
    description: "List every function in the snapshot, worst CRAP first",
    flags: {
      "--over N": "only functions at CRAP >= N",
      "--fields complexity": "add columns (complexity)",
    },
    examples: [`${BIN} list`, `${BIN} list --over 10 --fields complexity`],
  },
};

const TOP_HELP = `usage: ${BIN} [command] [flags]
commands:
  (none)  summarize .metrics/crap.edn and the CRAP < ${THRESHOLD} gate
  run     run the analysis, then summarize
  list    list all functions worst first
`;

function percent(value: number | null): string {
  return value === null ? "n/a" : `${value.toFixed(1)}%`;
}

function score(value: number | null): number | string {
  return value === null ? "n/a" : Math.round(value * 100) / 100;
}

function row(entry: CrapEntry, fields: readonly string[]): Output {
  const base: Output = {
    crap: score(entry.crap),
    coverage: percent(entry.coverage),
    function: functionLabel(entry),
  };
  if (fields.includes("complexity")) base["complexity"] = entry.complexity;
  return base;
}

function loadEntries(cwd: string): { value: CrapEntry[]; mtimeMs: number } | null {
  return loadSnapshot(CRAPPER, cwd, parseCrapSnapshot);
}

function summaryOutput(cwd: string, threshold: number): Output {
  const loaded = loadEntries(cwd);
  if (!loaded) return noSnapshot(CRAPPER);
  const summary = summarize(loaded.value, threshold);
  const { header, help } = snapshotHeader(CRAPPER, cwd, loaded.mtimeMs);
  if (summary.over.length > 0) {
    help.push(`Run \`${BIN} run <path>\` after splitting or testing a flagged function`);
  }
  help.push(`Run \`${BIN} list\` for all ${summary.total} functions`);
  const graded = loaded.value.filter((e) => e.coverage !== null);
  const noCoverage = graded.length > 0 && graded.every((e) => e.coverage === 0);
  return {
    ...(noCoverage ? { warning: NO_COVERAGE } : {}),
    snapshot: header,
    gate: summary.gate,
    functions: `${summary.total} total, ${summary.over.length} at CRAP >= ${threshold}, ${summary.ungraded} ungraded`,
    over: summary.over.slice(0, HOME_LIMIT).map((e) => row(e, [])),
    help,
  };
}

function parseFields(raw: string | undefined): string[] {
  if (raw === undefined) return [];
  const fields = raw.split(",").map((f) => f.trim());
  for (const field of fields) {
    if (!(EXTRA_FIELDS as readonly string[]).includes(field)) {
      throw new AxiError(`unknown field ${field}`, "VALIDATION_ERROR", [
        `valid fields: ${EXTRA_FIELDS.join(", ")}`,
      ]);
    }
  }
  return fields;
}

function list(deps: CliDeps, args: string[]): Output {
  const { cwd } = deps;
  const { flags } = parseFlags(args, LIST_SPEC);
  const fields = parseFields(flags["--fields"] as string | undefined);
  const loaded = loadEntries(cwd);
  if (!loaded) return summaryOutput(cwd, THRESHOLD);
  if (loaded.value.length === 0) return { functions: "0 in the snapshot" };
  const over = flags["--over"] as number | undefined;
  const shown = rank(loaded.value, over);
  if (shown.length === 0) {
    return { functions: `0 of ${loaded.value.length} at CRAP >= ${over}` };
  }
  return { functions: shown.map((e) => row(e, fields)) };
}

async function run(deps: CliDeps, args: string[]): Promise<Output> {
  const { flags, positionals } = parseFlags(args, RUN_SPEC);
  const toolArgs = [...positionals];
  const notes: string[] = [];
  if (flags["--changed"]) {
    toolArgs.push("--changed");
    notes.push("(git changes)");
  }
  if (flags["--no-coverage"]) toolArgs.push("--no-coverage");
  await runWrapped(CRAPPER, deps, { args: toolArgs, paths: positionals, notes });
  const threshold = flags["--threshold"];
  return summaryOutput(deps.cwd, typeof threshold === "number" ? threshold : THRESHOLD);
}

const DESCRIPTION = "CRAP scores (complexity x coverage) per function, gated at CRAP < 10";

function home(deps: CliDeps): Output {
  return summaryOutput(deps.cwd, THRESHOLD);
}

const COMMANDS = { description: DESCRIPTION, topLevelHelp: TOP_HELP, help: HELP, home, run, list };

/** Builds the runtime options for `runAxiCli`, with the project directory and env injected. */
export function buildCli(deps: CliDeps): AxiCliOptions {
  return wrappedCli(CRAPPER, COMMANDS, deps);
}

export async function main(): Promise<void> {
  await runAxiCli(buildCli({ cwd: process.cwd(), env: process.env, progress: process.stderr }));
}
