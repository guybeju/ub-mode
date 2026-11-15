import {
  chmodSync,
  cpSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runAxiCli } from "axi-sdk-js";
import { afterEach, describe, expect, it } from "vitest";
import { buildCli } from "#src/cli";

const FIXTURE = new URL("../../../fixtures/sample", import.meta.url).pathname;
const OLD = new Date("2026-01-01T00:00:00Z");
const NEW = new Date("2026-01-02T00:00:00Z");

function sampleProject(): string {
  const root = mkdtempSync(join(tmpdir(), "dryer-axi-"));
  cpSync(FIXTURE, root, { recursive: true });
  utimesSync(join(root, "src/demo/board.py"), OLD, OLD);
  utimesSync(join(root, "src/demo/__init__.py"), OLD, OLD);
  utimesSync(join(root, "tests/test_board.py"), OLD, OLD);
  utimesSync(join(root, ".metrics/dry.edn"), NEW, NEW);
  return root;
}

function stubTool(body: string): string {
  const path = join(mkdtempSync(join(tmpdir(), "dryer-stub-")), "dryer");
  writeFileSync(path, `#!/bin/sh\n${body}\n`);
  chmodSync(path, 0o755);
  return path;
}

async function run(argv: string[], cwd: string, tool = "/nonexistent/dryer") {
  let out = "";
  await runAxiCli({
    ...buildCli({ cwd, env: { DRYER_AXI_TOOL: tool }, progress: { write: () => true } }),
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
  it("shows the gate and the pairs at or above 0.8", async () => {
    const { out, exitCode } = await run([], sampleProject());
    expect(exitCode).toBe(0);
    expect(out).toContain("gate: fail");
    expect(out).toContain("candidates: 1 at score >= 0.8 of 2 in the snapshot");
    expect(out).toMatch(
      /pairs\[1\]\{score,left,right\}:\n\s+1,"src\/demo\/board\.py:35-40","src\/demo\/board\.py:43-48"/,
    );
    expect(out).toContain("dryer-axi list");
    expect(out).toContain("after extracting the shared shape");
  });

  it("warns that a snapshot from another run may have used a different threshold", async () => {
    const { out } = await run([], sampleProject());
    expect(out).toContain("scope: unknown");
    expect(out).toContain("Run `dryer-axi run` so the snapshot uses the 0.8 threshold");
  });

  it("says so plainly when there is no snapshot", async () => {
    const root = sampleProject();
    rmSync(join(root, ".metrics"), { recursive: true });
    const { out } = await run([], root);
    expect(out).toContain("snapshot: none at .metrics/dry.edn");
  });

  it("is ungraded when an empty snapshot's threshold is unknown or above 0.8", async () => {
    const root = sampleProject();
    writeFileSync(join(root, ".metrics/dry.edn"), "{:candidates []}\n");
    expect((await run([], root)).out).toContain("gate: ungraded");
    const tool = stubTool('echo "{:candidates []}" > .metrics/dry.edn');
    expect((await run(["run", "--threshold", "0.9"], root, tool)).out).toContain("gate: ungraded");
  });

  it("passes with an empty snapshot from a 0.8 run", async () => {
    const root = sampleProject();
    const tool = stubTool('echo "{:candidates []}" > .metrics/dry.edn');
    const { out } = await run(["run"], root, tool);
    expect(out).toContain("gate: pass");
    expect(out).not.toContain("after extracting");
    expect(out).not.toContain("[]");
    expect(out).toContain("candidates: 0 at score >= 0.8 of 0 in the snapshot");
  });
});

describe("list", () => {
  it("lists every pair closest first with its language", async () => {
    const { out } = await run(["list"], sampleProject());
    expect(out).toMatch(/pairs\[2\]\{score,language,left,right\}:/);
    expect(out.indexOf(":35-40")).toBeLessThan(out.indexOf(":21-25"));
  });

  it("filters with --threshold and states an empty result", async () => {
    expect((await run(["list", "--threshold", "0.9"], sampleProject())).out).toMatch(/pairs\[1\]/);
    expect((await run(["list", "--threshold", "1.5"], sampleProject())).out).toContain(
      "pairs: 0 of 2 at score >= 1.5",
    );
  });

  it("rejects an unknown flag with exit 2", async () => {
    expect((await run(["list", "--min"], sampleProject())).exitCode).toBe(2);
  });
});

describe("run", () => {
  it("runs dryer at the 0.8 threshold and records it in the scope", async () => {
    const root = sampleProject();
    const tool = stubTool('echo "$@" > args.txt; echo "{:candidates []}" > .metrics/dry.edn');
    const { out, exitCode } = await run(["run", "src", "--min-lines", "3"], root, tool);
    expect(exitCode).toBe(0);
    expect(readFileSync(join(root, "args.txt"), "utf8")).toBe(
      "src --threshold 0.8 --min-lines 3\n",
    );
    expect(out).toContain("gate: pass");
    expect(out).toContain("scope: src (threshold 0.8)");
  });

  it("passes --changed and a custom threshold through", async () => {
    const root = sampleProject();
    const tool = stubTool('echo "$@" > args.txt; echo "{:candidates []}" > .metrics/dry.edn');
    const { out } = await run(["run", "--changed", "--threshold", "0.9"], root, tool);
    expect(readFileSync(join(root, "args.txt"), "utf8")).toBe("--changed --threshold 0.9\n");
    expect(out).toContain("scope: whole project (git changes) (threshold 0.9)");
  });

  it("honors --threshold 0 in run and list", async () => {
    const root = sampleProject();
    const tool = stubTool('echo "$@" > args.txt');
    await run(["run", "--threshold", "0"], root, tool);
    expect(readFileSync(join(root, "args.txt"), "utf8")).toBe("--threshold 0\n");
    expect((await run(["list", "--threshold", "0"], sampleProject())).out).toMatch(/pairs\[2\]/);
  });

  it("records --min-lines in the scope", async () => {
    const root = sampleProject();
    const tool = stubTool('echo "{:candidates []}" > .metrics/dry.edn');
    expect((await run(["run", "--min-lines", "8"], root, tool)).out).toContain(
      "scope: whole project (threshold 0.8) (min-lines 8)",
    );
  });

  it("rejects arguments to update and skill", async () => {
    expect((await run(["update", "--force"], sampleProject())).exitCode).toBe(2);
    expect((await run(["skill", "x"], sampleProject())).exitCode).toBe(2);
  });

  it("turns a tool failure into TOOL_FAILED", async () => {
    const tool = stubTool("echo 'unknown output format' >&2; exit 2");
    const { out, exitCode } = await run(["run"], sampleProject(), tool);
    expect(exitCode).toBe(1);
    expect(out).toContain("code: TOOL_FAILED");
  });

  it("shows per-command help", async () => {
    const { out } = await run(["run", "--help"], sampleProject());
    expect(out).toContain("--min-lines N");
  });
});

describe("update", () => {
  it("explains this is a source build", async () => {
    expect((await run(["update"], sampleProject())).out).toContain("built from source");
  });
});
