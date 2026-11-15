import { chmodSync, mkdirSync, mkdtempSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  commandHelp,
  dropEmptyLists,
  loadSnapshot,
  noSnapshot,
  runWrapped,
  skillMarkdown,
  snapshotHeader,
  updateOutput,
  type Wrapped,
} from "#src/wrapper";

const OLD = new Date("2026-01-01T00:00:00Z");
const NEW = new Date("2026-01-02T00:00:00Z");

function project(): string {
  const root = mkdtempSync(join(tmpdir(), "ub-axi-wrap-"));
  mkdirSync(join(root, "src"));
  mkdirSync(join(root, ".metrics"));
  writeFileSync(join(root, "src/a.py"), "x");
  utimesSync(join(root, "src/a.py"), OLD, OLD);
  writeFileSync(join(root, ".metrics/t.edn"), "ok");
  utimesSync(join(root, ".metrics/t.edn"), NEW, NEW);
  return root;
}

function stub(body: string): string {
  const path = join(mkdtempSync(join(tmpdir(), "ub-axi-wrap-tool-")), "t");
  writeFileSync(path, `#!/bin/sh\n${body}\n`);
  chmodSync(path, 0o755);
  return path;
}

const T: Wrapped = {
  bin: "t-axi",
  tool: "t",
  envVar: "T_AXI_TOOL",
  repo: "https://github.com/unclebob/t",
  snapshot: ".metrics/t.edn",
  version: "1.2.3",
};
const quiet = { write: () => true };

describe("loadSnapshot", () => {
  it("parses the snapshot or returns null when it is absent", () => {
    const root = project();
    expect(loadSnapshot(T, root, (text) => text.toUpperCase())).toEqual({
      value: "OK",
      mtimeMs: NEW.getTime(),
    });
    expect(loadSnapshot({ ...T, snapshot: ".metrics/none.edn" }, root, () => 1)).toBeNull();
  });

  it("turns a parse failure into SNAPSHOT_INVALID", () => {
    const parse = () => {
      throw new Error("bad");
    };
    expect(() => loadSnapshot(T, project(), parse)).toThrow(
      expect.objectContaining({
        code: "SNAPSHOT_INVALID",
        message: ".metrics/t.edn is unreadable: bad",
      }),
    );
  });
});

describe("snapshotHeader", () => {
  it("describes path, time, scope and freshness, with a refresh hint when stale", () => {
    const root = project();
    expect(snapshotHeader(T, root, NEW.getTime())).toEqual({
      header: { path: ".metrics/t.edn", written: NEW.toISOString(), scope: "unknown", stale: "no" },
      help: [],
    });
    const later = new Date("2026-01-03T00:00:00Z");
    utimesSync(join(root, "src/a.py"), later, later);
    const stale = snapshotHeader(T, root, NEW.getTime());
    expect(stale.header["stale"]).toBe("1 source file changed since the snapshot");
    expect(stale.help).toEqual(["Run `t-axi run` to refresh"]);
  });
});

describe("runWrapped", () => {
  it("runs the tool and records the scope of the snapshot it wrote", async () => {
    const root = project();
    const tool = stub('echo "$@" > args.txt; echo new > .metrics/t.edn');
    await runWrapped(
      T,
      { cwd: root, env: { T_AXI_TOOL: tool }, progress: quiet },
      {
        args: ["src", "--x"],
        paths: ["src"],
        notes: ["(n)"],
      },
    );
    const mtime = loadSnapshot(T, root, (t) => t)?.mtimeMs ?? 0;
    expect(snapshotHeader(T, root, mtime).header["scope"]).toBe("src (n)");
  });

  it("reports a non-zero exit as TOOL_FAILED with the tool's last lines", async () => {
    const tool = stub("echo boom >&2; exit 4");
    const run = runWrapped(
      T,
      { cwd: project(), env: { T_AXI_TOOL: tool }, progress: quiet },
      {
        args: [],
        paths: [],
      },
    );
    await expect(run).rejects.toMatchObject({
      code: "TOOL_FAILED",
      message: "t exited 4",
      suggestions: ["boom"],
    });
  });

  it("accepts extra success exit codes", async () => {
    const tool = stub("exit 3");
    const deps = { cwd: project(), env: { T_AXI_TOOL: tool }, progress: quiet };
    await expect(runWrapped(T, deps, { args: [], paths: [], okExitCodes: [0, 3] })).resolves.toBe(
      3,
    );
  });

  it("names the override variable and the repo when the tool is missing", async () => {
    const deps = { cwd: project(), env: { T_AXI_TOOL: "/nonexistent/t" }, progress: quiet };
    await expect(runWrapped(T, deps, { args: [], paths: [] })).rejects.toMatchObject({
      code: "TOOL_MISSING",
      suggestions: [
        "git clone https://github.com/unclebob/t ~/.local/share/unclebob/t",
        "Put its `t` script on PATH, or set T_AXI_TOOL=<path to t>",
      ],
    });
  });
});

describe("merged snapshots", () => {
  it("reports a per-file merged scope and records none", async () => {
    const root = project();
    const merged: Wrapped = { ...T, merged: true };
    const tool = stub("echo new > .metrics/t.edn");
    await runWrapped(
      merged,
      { cwd: root, env: { T_AXI_TOOL: tool }, progress: quiet },
      {
        args: [],
        paths: ["src"],
      },
    );
    const mtime = loadSnapshot(T, root, (t) => t)?.mtimeMs ?? 0;
    expect(snapshotHeader(merged, root, mtime).header["scope"]).toBe("merged per file across runs");
    expect(snapshotHeader(T, root, mtime).header["scope"]).toBe("unknown");
  });
});

describe("skillMarkdown", () => {
  it("renders a trigger-shaped skill from the CLI's own description and help", () => {
    const md = skillMarkdown(T, {
      description: "Duplicate code candidates",
      topLevelHelp: "usage: t-axi\n",
      help: { run: { command: "run [paths..]", examples: ["t-axi run"] } },
      home: () => ({}),
      run: async () => ({}),
      list: () => ({}),
    });
    expect(md).toMatch(/^---\nname: t-axi\ndescription: >\n  Duplicate code candidates\. Use when/);
    expect(md).toContain("```\nusage: t-axi\n```");
    expect(md).toContain(
      '## t-axi run [paths..]\n\n```\ncommand: "run [paths..]"\nexamples[1]: t-axi run\n```',
    );
  });
});

describe("dropEmptyLists", () => {
  it("removes only empty arrays", () => {
    expect(dropEmptyLists({ a: [], b: [1], c: "", d: 0 })).toEqual({ b: [1], c: "", d: 0 });
  });
});

describe("small outputs", () => {
  it("states a missing snapshot with the command that creates it", () => {
    expect(noSnapshot(T)).toEqual({
      snapshot: "none at .metrics/t.edn",
      help: ["Run `t-axi run` to analyze this project"],
    });
  });

  it("explains that update does not apply to a source build", () => {
    expect(updateOutput(T)["update"]).toBe(
      "t-axi 1.2.3 is built from source and is not published to npm",
    );
  });

  it("renders known command help as TOON and nothing for others", () => {
    const help = commandHelp({ run: { command: "run", examples: ["a", "b"] } });
    expect(help("run")).toBe("command: run\nexamples[2]: a,b\n");
    expect(help("nope")).toBeNull();
  });
});
