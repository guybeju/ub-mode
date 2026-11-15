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
  const root = mkdtempSync(join(tmpdir(), "mutator-axi-"));
  cpSync(FIXTURE, root, { recursive: true });
  for (const file of ["src/demo/board.py", "src/demo/__init__.py", "tests/test_board.py"]) {
    utimesSync(join(root, file), OLD, OLD);
  }
  utimesSync(join(root, ".metrics/mutate/demo.board.edn"), NEW, NEW);
  return root;
}

function stubTool(body: string): string {
  const path = join(mkdtempSync(join(tmpdir(), "mutator-stub-")), "mutator");
  writeFileSync(path, `#!/bin/sh\n${body}\n`);
  chmodSync(path, 0o755);
  return path;
}

async function run(argv: string[], cwd: string, tool = "/nonexistent/mutator") {
  let out = "";
  await runAxiCli({
    ...buildCli({ cwd, env: { MUTATOR_AXI_TOOL: tool }, progress: { write: () => true } }),
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
  it("shows the gate, totals and each survivor at its source line", async () => {
    const { out, exitCode } = await run([], sampleProject());
    expect(exitCode).toBe(0);
    expect(out).toContain("gate: fail");
    expect(out).toMatch(/mutants: "?5 killed, 6 survived, 19 uncovered/);
    expect(out).toContain("scope: merged per file across runs");
    expect(out).toMatch(/survivors\[6\]\{at,function,from,to\}:/);
    expect(out).toMatch(/"src\/demo\/board\.py:2:10",demo\.board\.place,<,<=/);
    expect(out).toContain("mutator-axi list --uncovered");
  });

  it("says so plainly when there is no snapshot", async () => {
    const root = sampleProject();
    rmSync(join(root, ".metrics/mutate"), { recursive: true });
    const { out } = await run([], root);
    expect(out).toContain("snapshot: none at .metrics/mutate");
  });

  it("names the file of a corrupt snapshot", async () => {
    const root = sampleProject();
    writeFileSync(join(root, ".metrics/mutate/demo.board.edn"), "{:forms [");
    const { out, exitCode } = await run([], root);
    expect(exitCode).toBe(1);
    expect(out).toContain("code: SNAPSHOT_INVALID");
    expect(out).toContain("demo.board.edn");
  });

  it("falls back to the byte offset when the source file is gone", async () => {
    const root = sampleProject();
    rmSync(join(root, "src/demo/board.py"));
    expect((await run([], root)).out).toMatch(/src\/demo\/board\.py@byte \d+/);
  });
});

function oneOfEach(root: string, survived: number, uncovered: number): void {
  const key = JSON.stringify('["src/demo/board.py","demo.board","defn/place",33,34,"<","<="]');
  const status = survived > 0 ? ":survived" : ":killed";
  writeFileSync(
    join(root, ".metrics/mutate/demo.board.edn"),
    `{:namespace "demo.board" :outcomes {${key} ${status}} :forms [{:id "defn/place" :file "src/demo/board.py" :line 1 :end-line 7 :killed 1 :survived ${survived} :uncovered ${uncovered}}]}`,
  );
}

describe("hints and lists at the edges", () => {
  it("warns when mutants survived but none was killed", async () => {
    const root = sampleProject();
    oneOfEach(root, 1, 0);
    const edn = join(root, ".metrics/mutate/demo.board.edn");
    writeFileSync(edn, readFileSync(edn, "utf8").replace(":killed 1", ":killed 0"));
    expect((await run([], root)).out).toMatch(/warning: "?no mutant was killed/);
    expect((await run([], sampleProject())).out).not.toContain("warning:");
    oneOfEach(root, 0, 3);
    writeFileSync(edn, readFileSync(edn, "utf8").replace(":killed 1", ":killed 0"));
    expect((await run([], root)).out).not.toContain("warning:");
  });

  it("points run hints at a file or git changes, never the whole tree", async () => {
    const root = sampleProject();
    rmSync(join(root, ".metrics/mutate"), { recursive: true });
    expect((await run([], root)).out).toContain("Run `mutator-axi run <path>` to analyze");
    const stale = sampleProject();
    const later = new Date("2026-01-03T00:00:00Z");
    utimesSync(join(stale, "src/demo/board.py"), later, later);
    expect((await run([], stale)).out).toContain("Run `mutator-axi run --changed` to refresh");
  });

  it("shows hints and rows for exactly one survivor and one uncovered site", async () => {
    const root = sampleProject();
    oneOfEach(root, 1, 1);
    const home = (await run([], root)).out;
    expect(home).toContain("after adding a test that kills a survivor");
    expect(home).toContain("list --uncovered");
    expect((await run(["list"], root)).out).toMatch(/survivors\[1\]/);
    expect((await run(["list", "--uncovered"], root)).out).toMatch(/uncovered\[1\]/);
  });

  it("drops the hints and states empty lists when nothing survived or is uncovered", async () => {
    const root = sampleProject();
    oneOfEach(root, 0, 0);
    const home = (await run([], root)).out;
    expect(home).toContain("gate: pass");
    expect(home).not.toContain("kills a survivor");
    expect(home).not.toContain("list --uncovered");
    expect(home).not.toContain("[]");
    expect((await run(["list"], root)).out).toContain("survivors: 0 surviving mutants");
    expect((await run(["list", "--uncovered"], root)).out).toContain(
      "uncovered: 0 functions with uncovered sites",
    );
  });
});

describe("list", () => {
  it("lists survivors by default", async () => {
    expect((await run(["list"], sampleProject())).out).toMatch(/survivors\[6\]/);
  });

  it("lists functions with uncovered mutation sites", async () => {
    const { out } = await run(["list", "--uncovered"], sampleProject());
    expect(out).toMatch(/uncovered\[4\]\{function,lines,uncovered\}:/);
    expect(out).toContain("demo.board.score");
  });

  it("rejects --survived with --uncovered", async () => {
    const { out, exitCode } = await run(["list", "--survived", "--uncovered"], sampleProject());
    expect(exitCode).toBe(2);
    expect(out).toContain("pick one of --survived or --uncovered");
  });
});

describe("run", () => {
  it("passes paths and flags through and treats survivors as a finished run", async () => {
    const root = sampleProject();
    const tool = stubTool('echo "$@" > args.txt; exit 3');
    const { out, exitCode } = await run(
      ["run", "src/demo/board.py", "--mutate-all", "--max-workers", "2"],
      root,
      tool,
    );
    expect(exitCode).toBe(0);
    expect(readFileSync(join(root, "args.txt"), "utf8")).toBe(
      "src/demo/board.py --mutate-all --max-workers 2\n",
    );
    expect(out).toContain("gate: fail");
  });

  it("reports failing baseline tests as their own error", async () => {
    const tool = stubTool("echo 'baseline tests failed' >&2; exit 2");
    const { out, exitCode } = await run(["run", "--changed"], sampleProject(), tool);
    expect(exitCode).toBe(1);
    expect(out).toContain("code: BASELINE_FAILED");
  });

  it("reports other tool exits as TOOL_FAILED", async () => {
    const tool = stubTool("exit 1");
    expect((await run(["run"], sampleProject(), tool)).out).toContain("code: TOOL_FAILED");
  });
});
