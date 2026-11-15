import { chmodSync, cpSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runAxiCli } from "axi-sdk-js";
import { afterEach, describe, expect, it } from "vitest";
import { buildCli } from "#src/cli";

const FIXTURE = new URL("../../../fixtures/sample", import.meta.url).pathname;
const OLD = new Date("2026-01-01T00:00:00Z");
const NEW = new Date("2026-01-02T00:00:00Z");

function sampleProject(): string {
  const root = mkdtempSync(join(tmpdir(), "crapper-axi-"));
  cpSync(FIXTURE, root, { recursive: true });
  utimesSync(join(root, "src/demo/board.py"), OLD, OLD);
  utimesSync(join(root, "src/demo/__init__.py"), OLD, OLD);
  utimesSync(join(root, "tests/test_board.py"), OLD, OLD);
  utimesSync(join(root, ".metrics/crap.edn"), NEW, NEW);
  return root;
}

function stubTool(body: string): string {
  const path = join(mkdtempSync(join(tmpdir(), "crapper-stub-")), "crapper");
  writeFileSync(path, `#!/bin/sh\n${body}\n`);
  chmodSync(path, 0o755);
  return path;
}

async function run(argv: string[], cwd: string, tool = "/nonexistent/crapper") {
  let out = "";
  await runAxiCli({
    ...buildCli({ cwd, env: { CRAPPER_AXI_TOOL: tool }, progress: { write: () => true } }),
    argv,
    stdout: { write: (chunk: string) => (out += chunk) },
  });
  const exitCode = process.exitCode ?? 0;
  process.exitCode = 0;
  return { out, exitCode };
}

afterEach(() => {
  process.exitCode = 0;
});

describe("home view", () => {
  it("summarizes the snapshot with the gate result and the worst functions", async () => {
    const { out, exitCode } = await run([], sampleProject());
    expect(exitCode).toBe(0);
    expect(out).toContain('description: "CRAP scores');
    expect(out).toContain("gate: fail");
    expect(out).toContain('functions: "4 total, 1 at CRAP >= 10, 0 ungraded"');
    expect(out).toContain("stale: no");
    expect(out).toMatch(
      /over\[1\]\{crap,coverage,function\}:\n\s+31\.28,11\.1%,demo\.board\.score/,
    );
    expect(out).toContain("crapper-axi list");
    expect(out).toContain("after splitting or testing a flagged function");
  });

  it("flags sources changed after the snapshot", async () => {
    const root = sampleProject();
    const later = new Date("2026-01-03T00:00:00Z");
    utimesSync(join(root, "src/demo/board.py"), later, later);
    const { out } = await run([], root);
    expect(out).toContain("stale: 1 source file changed since the snapshot");
    expect(out).toContain("Run `crapper-axi run` to refresh");
  });

  it("says so plainly when there is no snapshot", async () => {
    const root = sampleProject();
    rmSync(join(root, ".metrics"), { recursive: true });
    const { out, exitCode } = await run([], root);
    expect(exitCode).toBe(0);
    expect(out).toContain("snapshot: none at .metrics/crap.edn");
    expect(out).toContain("Run `crapper-axi run` to analyze this project");
  });

  it("reports a corrupt snapshot as a structured error", async () => {
    const root = sampleProject();
    writeFileSync(join(root, ".metrics/crap.edn"), "{:entries [");
    const { out, exitCode } = await run([], root);
    expect(exitCode).toBe(1);
    expect(out).toContain("code: SNAPSHOT_INVALID");
  });
});

describe("home view hints", () => {
  it("warns when every graded function has 0% coverage", async () => {
    const root = sampleProject();
    writeFileSync(
      join(root, ".metrics/crap.edn"),
      '{:entries [{:name "f", :namespace "m", :complexity 2, :coverage 0.0, :crap 6.0}]}',
    );
    expect((await run([], root)).out).toMatch(/warning: "?every function shows 0% coverage/);
    expect((await run([], sampleProject())).out).not.toContain("warning:");
    writeFileSync(
      join(root, ".metrics/crap.edn"),
      '{:entries [{:name "f", :namespace "m", :complexity 2, :coverage nil, :crap nil}]}',
    );
    expect((await run([], root)).out).not.toContain("warning:");
  });

  it("does not suggest splitting when the gate passes", async () => {
    const root = sampleProject();
    writeFileSync(
      join(root, ".metrics/crap.edn"),
      '{:entries [{:name "f", :namespace "m", :complexity 1, :coverage 100.0, :crap 1.0}]}',
    );
    const { out } = await run([], root);
    expect(out).toContain("gate: pass");
    expect(out).not.toContain("after splitting");
    expect(out).not.toContain("[]");
  });

  it("applies a run's --threshold, even 0", async () => {
    const tool = stubTool("true");
    const { out } = await run(["run", "--threshold", "0"], sampleProject(), tool);
    expect(out).toContain("4 at CRAP >= 0");
  });
});

describe("list", () => {
  it("lists every function worst first", async () => {
    const { out } = await run(["list"], sampleProject());
    expect(out).toMatch(/functions\[4\]\{crap,coverage,function\}:/);
    expect(out.indexOf("demo.board.score")).toBeLessThan(out.indexOf("demo.board.alpha"));
  });

  it("filters with --over and adds complexity with --fields", async () => {
    const { out } = await run(["list", "--over", "5", "--fields", "complexity"], sampleProject());
    expect(out).toMatch(/functions\[2\]\{crap,coverage,function,complexity\}:/);
  });

  it("states an empty result", async () => {
    const { out } = await run(["list", "--over", "100"], sampleProject());
    expect(out).toContain("functions: 0 of 4 at CRAP >= 100");
  });

  it("states an empty snapshot", async () => {
    const root = sampleProject();
    writeFileSync(join(root, ".metrics/crap.edn"), "{:entries []}\n");
    expect((await run(["list"], root)).out).toContain("functions: 0 in the snapshot");
  });

  it("rejects an unknown flag or field with exit 2", async () => {
    expect((await run(["list", "--stat"], sampleProject())).exitCode).toBe(2);
    const bad = await run(["list", "--fields", "colour"], sampleProject());
    expect(bad.exitCode).toBe(2);
    expect(bad.out).toContain("unknown field colour");
  });
});

describe("run", () => {
  it("passes paths and flags through, then summarizes the new snapshot and records its scope", async () => {
    const root = sampleProject();
    const tool = stubTool(
      `echo "$@" > args.txt; printf '{:entries [{:name "f", :namespace "m", :complexity 1, :coverage 100.0, :crap 1.0}]}' > .metrics/crap.edn`,
    );
    const { out, exitCode } = await run(
      ["run", "src/demo", "--no-coverage", "--changed"],
      root,
      tool,
    );
    expect(exitCode).toBe(0);
    expect(out).toContain("gate: pass");
    expect(out).toContain("scope: src/demo");
    expect((await run([], root, tool)).out).toContain("scope: src/demo");
  });

  it("turns a tool failure into a structured error with the tool's last lines", async () => {
    const tool = stubTool('echo "No module named crapper" >&2; exit 1');
    const { out, exitCode } = await run(["run"], sampleProject(), tool);
    expect(exitCode).toBe(1);
    expect(out).toContain("code: TOOL_FAILED");
    expect(out).toContain("No module named crapper");
  });

  it("explains how to install a missing tool", async () => {
    const { out, exitCode } = await run(["run"], sampleProject());
    expect(exitCode).toBe(1);
    expect(out).toContain("code: TOOL_MISSING");
    expect(out).toContain("CRAPPER_AXI_TOOL");
  });

  it("shows per-command help", async () => {
    const { out } = await run(["run", "--help"], sampleProject());
    expect(out).toContain("--no-coverage");
    expect(out).toContain("examples[3]:");
  });
});

describe("update", () => {
  it("explains this is a source build instead of reaching npm", async () => {
    const { out, exitCode } = await run(["update"], sampleProject());
    expect(exitCode).toBe(0);
    expect(out).toContain("built from source");
  });
});
