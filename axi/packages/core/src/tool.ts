import { spawn } from "node:child_process";
import { basename } from "node:path";
import { AxiError } from "axi-sdk-js";

const TAIL_LINES = 5;

export interface Writer {
  write: (chunk: string) => unknown;
}

export interface ToolRun {
  tool: string;
  args: string[];
  cwd: string;
  progress: Writer;
  missingHelp: string[];
}

export interface ToolResult {
  exitCode: number;
  stderrTail: string[];
}

/** Picks the wrapped tool's command: the override variable if set, else its name on PATH. */
export function resolveTool(name: string, envVar: string, env: NodeJS.ProcessEnv): string {
  return env[envVar] || name;
}

function tail(text: string): string[] {
  return text
    .split("\n")
    .filter((line) => line.trim() !== "")
    .slice(-TAIL_LINES);
}

/**
 * Runs the wrapped tool to completion. Its stdout and stderr stream to `progress`
 * (never to the AXI's stdout); the last stderr lines are kept for error reports.
 *
 * Raises:
 *   AxiError TOOL_MISSING when the command cannot be started.
 */
export function runTool(run: ToolRun): Promise<ToolResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(run.tool, run.args, { cwd: run.cwd, stdio: ["ignore", "pipe", "pipe"] });
    let stderr = "";
    child.stdout.on("data", (chunk: Buffer) => run.progress.write(chunk.toString()));
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
      run.progress.write(chunk.toString());
    });
    child.on("error", (error: NodeJS.ErrnoException) => {
      const name = basename(run.tool);
      const message =
        error.code === "ENOENT" ? `${name} not found (looked for ${run.tool})` : error.message;
      reject(new AxiError(message, "TOOL_MISSING", run.missingHelp));
    });
    child.on("close", (code) => resolve({ exitCode: code ?? 1, stderrTail: tail(stderr) }));
  });
}
