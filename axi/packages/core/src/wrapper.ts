import { AxiError, type AxiCliOptions } from "axi-sdk-js";
import { parseFlags } from "#src/flags";
import {
  countNewerSources,
  readScope,
  readSnapshot,
  writeScope,
  type ScopeRun,
} from "#src/snapshot";
import { toToon } from "#src/toon";
import { resolveTool, runTool, type Writer } from "#src/tool";

export type Output = Record<string, unknown>;

/** What an AXI needs to know about the Python tool it wraps. */
export interface Wrapped {
  bin: string;
  tool: string;
  envVar: string;
  repo: string;
  snapshot: string;
  version: string;
  /** The tool merges each run into its snapshot per file, so no single run scopes it. */
  merged?: boolean;
  /** `run` arguments to suggest for a first analysis and for a refresh; default none. */
  analyzeArgs?: string;
  refreshArgs?: string;
}

function runCommandText(w: Wrapped, args: string | undefined): string {
  return args ? `${w.bin} run ${args}` : `${w.bin} run`;
}

export interface CliDeps {
  cwd: string;
  env: NodeJS.ProcessEnv;
  progress: Writer;
}

export interface WrappedRun extends ScopeRun {
  args: string[];
  okExitCodes?: number[];
}

/** Reads and parses the wrapped tool's snapshot; null when it has not been written yet. */
export function loadSnapshot<T>(
  w: Wrapped,
  cwd: string,
  parse: (text: string) => T,
): { value: T; mtimeMs: number } | null {
  const snapshot = readSnapshot(cwd, w.snapshot);
  if (!snapshot) return null;
  try {
    return { value: parse(snapshot.text), mtimeMs: snapshot.mtimeMs };
  } catch (error) {
    throw new AxiError(
      `${w.snapshot} is unreadable: ${(error as Error).message}`,
      "SNAPSHOT_INVALID",
      [`Run \`${w.bin} run\` to rewrite it`],
    );
  }
}

function staleText(count: number): string {
  if (count === 0) return "no";
  return `${count} source file${count === 1 ? "" : "s"} changed since the snapshot`;
}

/** The `snapshot:` block every home view starts with, plus a refresh hint when it is stale. */
export function snapshotHeader(
  w: Wrapped,
  cwd: string,
  mtimeMs: number,
): { header: Output; help: string[] } {
  const stale = countNewerSources(cwd, mtimeMs);
  return {
    header: {
      path: w.snapshot,
      written: new Date(mtimeMs).toISOString(),
      scope: w.merged ? "merged per file across runs" : readScope(cwd, w.tool, mtimeMs),
      stale: staleText(stale),
    },
    help: stale > 0 ? [`Run \`${runCommandText(w, w.refreshArgs)}\` to refresh`] : [],
  };
}

/** A one-line answer under `key` with the single command to run next. */
function notice(key: string, text: string, next: string): Output {
  return { [key]: text, help: [next] };
}

export function noSnapshot(w: Wrapped): Output {
  return notice(
    "snapshot",
    `none at ${w.snapshot}`,
    `Run \`${runCommandText(w, w.analyzeArgs)}\` to analyze this project`,
  );
}

/**
 * Runs the wrapped tool in the project and records the scope of the snapshot it wrote.
 *
 * Returns the tool's exit code when it is one of `okExitCodes` (default only 0).
 *
 * Raises:
 *   AxiError TOOL_MISSING when the tool cannot be started, TOOL_FAILED on any other exit code.
 */
export async function runWrapped(w: Wrapped, deps: CliDeps, run: WrappedRun): Promise<number> {
  const result = await runTool({
    tool: resolveTool(w.tool, w.envVar, deps.env),
    args: run.args,
    cwd: deps.cwd,
    progress: deps.progress,
    missingHelp: [
      `git clone ${w.repo} ~/.local/share/unclebob/${w.tool}`,
      `Put its \`${w.tool}\` script on PATH, or set ${w.envVar}=<path to ${w.tool}>`,
    ],
  });
  const { okExitCodes = [0] } = run;
  if (!okExitCodes.includes(result.exitCode)) {
    throw new AxiError(`${w.tool} exited ${result.exitCode}`, "TOOL_FAILED", result.stderrTail);
  }
  const snapshot = w.merged ? null : readSnapshot(deps.cwd, w.snapshot);
  if (snapshot) {
    writeScope(deps.cwd, w.tool, run, snapshot.mtimeMs);
  }
  return result.exitCode;
}

export function updateOutput(w: Wrapped): Output {
  const text = `${w.bin} ${w.version} is built from source and is not published to npm`;
  return notice(
    "update",
    text,
    "Pull the repository and run `pnpm build` in its axi directory to update",
  );
}

/** Builds the SDK's `getCommandHelp` from per-command help blocks. */
export function commandHelp(helps: Record<string, Output>): (command: string) => string | null {
  return (command) => {
    const help = helps[command];
    return help ? toToon(help) : null;
  };
}

/** The parts of an AXI that differ per wrapped tool; the rest of the CLI shape is shared. */
export interface WrappedCommands {
  description: string;
  topLevelHelp: string;
  help: Record<string, Output>;
  home: (deps: CliDeps) => Output;
  run: (deps: CliDeps, args: string[]) => Promise<Output>;
  list: (deps: CliDeps, args: string[]) => Output;
}

function noArguments(w: Wrapped, command: string, args: string[]): void {
  parseFlags(args, { command, bin: w.bin, flags: {}, positionals: "none" });
}

/** Omits empty lists: the counts beside them already state the zero (AXI definitive empty). */
export function dropEmptyLists(output: Output): Output {
  return Object.fromEntries(
    Object.entries(output).filter(([, v]) => !(Array.isArray(v) && v.length === 0)),
  );
}

/** Builds `runAxiCli` options: home, `run`, `list`, a local-build `update`, and TOON help. */
export function wrappedCli(w: Wrapped, commands: WrappedCommands, deps: CliDeps): AxiCliOptions {
  return {
    description: commands.description,
    version: w.version,
    topLevelHelp: `${commands.topLevelHelp}  skill   print this tool's Agent Skill (SKILL.md)\n`,
    getCommandHelp: commandHelp(commands.help),
    home: () => dropEmptyLists(commands.home(deps)),
    commands: {
      run: async (args) => dropEmptyLists(await commands.run(deps, args)),
      list: (args) => dropEmptyLists(commands.list(deps, args)),
      update: (args) => {
        noArguments(w, "update", args);
        return updateOutput(w);
      },
      skill: (args) => {
        noArguments(w, "skill", args);
        return skillMarkdown(w, commands);
      },
    },
  };
}

/**
 * The tool's Agent Skill, generated from the same description and help the CLI prints,
 * so the skill cannot drift from the commands.
 */
export function skillMarkdown(w: Wrapped, commands: WrappedCommands): string {
  const sections = Object.entries(commands.help).map(
    ([, help]) => `## ${w.bin} ${String(help["command"])}\n\n\`\`\`\n${toToon(help)}\`\`\`\n`,
  );
  return [
    "---",
    `name: ${w.bin}`,
    "description: >",
    `  ${commands.description}. Use when running ub-mode's ${w.tool} step or checking this gate in a project.`,
    "---",
    "",
    `# ${w.bin}`,
    "",
    `Run \`${w.bin}\` with no arguments in the project root for the gate summary from \`${w.snapshot}\`.`,
    "",
    "```",
    commands.topLevelHelp.trimEnd(),
    "```",
    "",
    ...sections,
  ].join("\n");
}
