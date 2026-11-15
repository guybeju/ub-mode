import { chmodSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AxiError } from "axi-sdk-js";
import { describe, expect, it } from "vitest";
import { resolveTool, runTool } from "#src/tool";

function stub(body: string): string {
  const dir = mkdtempSync(join(tmpdir(), "ub-axi-tool-"));
  const path = join(dir, "fake-tool");
  writeFileSync(path, `#!/bin/sh\n${body}\n`);
  chmodSync(path, 0o755);
  return path;
}

const silent = { write: () => true };

describe("resolveTool", () => {
  it("prefers the override variable, then the tool name on PATH", () => {
    expect(resolveTool("crapper", "CRAPPER_AXI_TOOL", { CRAPPER_AXI_TOOL: "/x/crapper" })).toBe(
      "/x/crapper",
    );
    expect(resolveTool("crapper", "CRAPPER_AXI_TOOL", {})).toBe("crapper");
  });
});

describe("runTool", () => {
  it("runs in the project directory with the given arguments and reports the exit code", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "ub-axi-cwd-"));
    const tool = stub('echo "$@" > args.txt; exit 3');
    const result = await runTool({
      tool,
      args: ["--changed", "src"],
      cwd,
      progress: silent,
      missingHelp: [],
    });
    expect(result.exitCode).toBe(3);
    expect(readFileSync(join(cwd, "args.txt"), "utf8")).toBe("--changed src\n");
  });

  it("keeps the last stderr lines for error reports and streams output to progress", async () => {
    const seen: string[] = [];
    const tool = stub(
      'echo table; i=1; while [ $i -le 8 ]; do echo "line $i" >&2; i=$((i+1)); done; exit 1',
    );
    const result = await runTool({
      tool,
      args: [],
      cwd: tmpdir(),
      progress: { write: (chunk: string) => seen.push(chunk) },
      missingHelp: [],
    });
    expect(result.stderrTail).toEqual(["line 4", "line 5", "line 6", "line 7", "line 8"]);
    expect(seen.join("")).toContain("table");
    expect(seen.join("")).toContain("line 1");
  });

  it("raises TOOL_MISSING naming the command and carrying the install steps", async () => {
    const run = runTool({
      tool: "/nonexistent/crapper",
      args: [],
      cwd: tmpdir(),
      progress: silent,
      missingHelp: ["install it"],
    });
    await expect(run).rejects.toBeInstanceOf(AxiError);
    await expect(run).rejects.toMatchObject({
      code: "TOOL_MISSING",
      message: "crapper not found (looked for /nonexistent/crapper)",
      suggestions: ["install it"],
    });
  });

  it("reports why a present tool could not start", async () => {
    const path = join(mkdtempSync(join(tmpdir(), "ub-axi-noexec-")), "crapper");
    writeFileSync(path, "#!/bin/sh\n");
    const run = runTool({ tool: path, args: [], cwd: tmpdir(), progress: silent, missingHelp: [] });
    await expect(run).rejects.toMatchObject({
      code: "TOOL_MISSING",
      message: expect.stringContaining("EACCES"),
    });
  });

  it("treats a tool killed by a signal as exit 1", async () => {
    const tool = stub("kill -9 $$");
    const result = await runTool({
      tool,
      args: [],
      cwd: tmpdir(),
      progress: silent,
      missingHelp: [],
    });
    expect(result.exitCode).toBe(1);
  });
});
