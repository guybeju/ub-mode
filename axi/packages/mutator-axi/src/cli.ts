import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { AxiError, runAxiCli, type AxiCliOptions } from "axi-sdk-js";
import { parseFlags, type FlagSpec } from "@ub-axi/core/flags";
import {
  noSnapshot,
  runWrapped,
  snapshotHeader,
  wrappedCli,
  type CliDeps,
  type Output,
  type Wrapped,
} from "@ub-axi/core/wrapper";
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
import { VERSION } from "#src/version";

const BIN = "mutator-axi";
const HOME_LIMIT = 10;
const BASELINE_FAILED = 2;
const SURVIVORS_FOUND = 3;

const MUTATOR: Wrapped = {
  bin: BIN,
  tool: "mutator",
  envVar: "MUTATOR_AXI_TOOL",
  repo: "https://github.com/unclebob/mutator",
  snapshot: ".metrics/mutate",
  version: VERSION,
  merged: true,
  analyzeArgs: "<path>",
  refreshArgs: "--changed",
};

const NOTHING_KILLED =
  "no mutant was killed: the tests may not run, or may load the original file instead of " +
  "the mutated copy (keep test imports resolvable through symlinks)";

export type { CliDeps };

const RUN_SPEC: FlagSpec = {
  command: "run",
  bin: BIN,
  flags: {
    "--changed": { kind: "boolean" },
    "--mutate-all": { kind: "boolean" },
    "--max-workers": { kind: "number" },
  },
  positionals: "many",
};

const LIST_SPEC: FlagSpec = {
  command: "list",
  bin: BIN,
  flags: { "--survived": { kind: "boolean" }, "--uncovered": { kind: "boolean" } },
  positionals: "none",
};

const HELP: Record<string, Output> = {
  run: {
    command: "run [paths..]",
    description: "Run mutator (mutation testing against the project's tests) and summarize",
    flags: {
      "--changed": "only files with git additions or edits",
      "--mutate-all": "rerun killed mutants too",
      "--max-workers N": "parallel workers, default one per core",
    },
    examples: [`${BIN} run src/demo/board.py`, `${BIN} run --changed`],
  },
  list: {
    command: "list",
    description: "List surviving mutants (default) or functions with uncovered sites",
    flags: {
      "--survived": "surviving mutants (default)",
      "--uncovered": "uncovered sites per function",
    },
    examples: [`${BIN} list`, `${BIN} list --uncovered`],
  },
};

const TOP_HELP = `usage: ${BIN} [command] [flags]
commands:
  (none)  summarize .metrics/mutate and the zero-survivor gate
  run     run mutation testing, then summarize
  list    list survivors, or uncovered sites with --uncovered
`;

interface Loaded {
  forms: Form[];
  outcomes: Outcome[];
  mtimeMs: number;
}

function loadMutate(cwd: string): Loaded | null {
  const dir = join(cwd, MUTATOR.snapshot);
  let names: string[];
  try {
    names = readdirSync(dir).filter((n) => n.endsWith(".edn"));
  } catch {
    return null;
  }
  if (names.length === 0) return null;
  const forms: Form[] = [];
  const outcomes: Outcome[] = [];
  const mtimes: number[] = [];
  for (const name of names) {
    const path = join(dir, name);
    try {
      const parsed = parseMutateFile(readFileSync(path, "utf8"));
      forms.push(...parsed.forms);
      outcomes.push(...parsed.outcomes);
    } catch (error) {
      throw new AxiError(
        `${MUTATOR.snapshot}/${name} is unreadable: ${(error as Error).message}`,
        "SNAPSHOT_INVALID",
        [`Run \`${BIN} run\` to rewrite it`],
      );
    }
    mtimes.push(statSync(path).mtimeMs);
  }
  return { forms, outcomes, mtimeMs: Math.max(...mtimes) };
}

function locator(cwd: string): (file: string, offset: number) => string {
  const cache = new Map<string, Buffer | null>();
  return (file, offset) => {
    if (!cache.has(file)) {
      try {
        cache.set(file, readFileSync(join(cwd, file)));
      } catch {
        cache.set(file, null);
      }
    }
    const bytes = cache.get(file);
    if (!bytes) return `${file}@byte ${offset}`;
    const { line, column } = positionAt(bytes, offset);
    return `${file}:${line}:${column}`;
  };
}

function survivorRows(cwd: string, outcomes: Outcome[]): Output[] {
  const at = locator(cwd);
  return survivorsInOrder(outcomes).map((o) => ({
    at: at(o.file, o.start),
    function: functionName(o.namespace, o.formId),
    from: o.from,
    to: o.to,
  }));
}

function uncoveredRows(forms: Form[]): Output[] {
  return uncoveredForms(forms).map((f) => ({
    function: functionName(f.namespace, f.id),
    lines: `${f.file}:${f.line}-${f.endLine}`,
    uncovered: f.uncovered,
  }));
}

function summaryOutput(cwd: string): Output {
  const loaded = loadMutate(cwd);
  if (!loaded) return noSnapshot(MUTATOR);
  const summary = summarize(loaded.forms);
  const { header, help } = snapshotHeader(MUTATOR, cwd, loaded.mtimeMs);
  const survivors = survivorRows(cwd, loaded.outcomes);
  if (survivors.length > 0) {
    help.push(`Run \`${BIN} run <file>\` after adding a test that kills a survivor`);
  }
  if (summary.uncovered > 0) help.push(`Run \`${BIN} list --uncovered\` to see untested sites`);
  const nothingKilled = summary.killed === 0 && summary.survived > 0;
  return {
    ...(nothingKilled ? { warning: NOTHING_KILLED } : {}),
    snapshot: header,
    gate: summary.gate,
    mutants: `${summary.killed} killed, ${summary.survived} survived, ${summary.uncovered} uncovered`,
    survivors: survivors.slice(0, HOME_LIMIT),
    help,
  };
}

function list(deps: CliDeps, args: string[]): Output {
  const { cwd } = deps;
  const { flags } = parseFlags(args, LIST_SPEC);
  if (flags["--survived"] && flags["--uncovered"]) {
    throw new AxiError("pick one of --survived or --uncovered", "VALIDATION_ERROR", [
      `Run \`${BIN} list\` or \`${BIN} list --uncovered\``,
    ]);
  }
  const loaded = loadMutate(cwd);
  if (!loaded) return noSnapshot(MUTATOR);
  if (flags["--uncovered"]) {
    const rows = uncoveredRows(loaded.forms);
    return { uncovered: rows.length > 0 ? rows : "0 functions with uncovered sites" };
  }
  const rows = survivorRows(cwd, loaded.outcomes);
  return { survivors: rows.length > 0 ? rows : "0 surviving mutants" };
}

async function run(deps: CliDeps, args: string[]): Promise<Output> {
  const { flags, positionals } = parseFlags(args, RUN_SPEC);
  const toolArgs = [...positionals];
  if (flags["--changed"]) toolArgs.push("--changed");
  if (flags["--mutate-all"]) toolArgs.push("--mutate-all");
  const workers = flags["--max-workers"];
  if (workers !== undefined) toolArgs.push("--max-workers", String(workers));
  const exitCode = await runWrapped(MUTATOR, deps, {
    args: toolArgs,
    paths: positionals,
    okExitCodes: [0, BASELINE_FAILED, SURVIVORS_FOUND],
  });
  if (exitCode === BASELINE_FAILED) {
    throw new AxiError("the project's tests fail before any mutation", "BASELINE_FAILED", [
      "Fix the failing tests, then rerun `mutator-axi run --changed`",
    ]);
  }
  return summaryOutput(deps.cwd);
}

const DESCRIPTION = "Mutation testing survivors and coverage gaps, gated at zero survivors";

function home(deps: CliDeps): Output {
  return summaryOutput(deps.cwd);
}

const COMMANDS = { description: DESCRIPTION, topLevelHelp: TOP_HELP, help: HELP, home, run, list };

/** Builds the runtime options for `runAxiCli`, with the project directory and env injected. */
export function buildCli(deps: CliDeps): AxiCliOptions {
  return wrappedCli(MUTATOR, COMMANDS, deps);
}

export async function main(): Promise<void> {
  await runAxiCli(buildCli({ cwd: process.cwd(), env: process.env, progress: process.stderr }));
}
