import { mkdirSync, mkdtempSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  countNewerSources,
  readScope,
  readScopeDetails,
  readSnapshot,
  writeScope,
} from "#src/snapshot";

const T0 = new Date("2026-01-01T00:00:00Z");
const T1 = new Date("2026-01-02T00:00:00Z");

function project(files: Record<string, Date>): string {
  const root = mkdtempSync(join(tmpdir(), "ub-axi-"));
  for (const [path, mtime] of Object.entries(files)) {
    const full = join(root, path);
    mkdirSync(join(full, ".."), { recursive: true });
    writeFileSync(full, "x");
    utimesSync(full, mtime, mtime);
  }
  return root;
}

describe("readSnapshot", () => {
  it("returns null when the snapshot does not exist", () => {
    expect(readSnapshot(project({}), ".metrics/crap.edn")).toBeNull();
  });

  it("raises errors other than a missing file", () => {
    const root = project({ ".metrics/crap.edn/inner": T0 });
    expect(() => readSnapshot(root, ".metrics/crap.edn")).toThrow("EISDIR");
  });

  it("returns the text and modification time", () => {
    const root = project({ ".metrics/crap.edn": T0 });
    expect(readSnapshot(root, ".metrics/crap.edn")).toEqual({
      text: "x",
      mtimeMs: T0.getTime(),
    });
  });
});

describe("countNewerSources", () => {
  it("counts source and test files newer than the snapshot, skipping tool and vendor dirs", () => {
    const root = project({
      "src/a.py": T1,
      "src/b.py": T0,
      "tests/test_a.py": T1,
      "src/readme.md": T1,
      "node_modules/x/index.js": T1,
      ".venv/lib/x.py": T1,
      "target/gen.java": T1,
      ".metrics/crap.edn": T1,
    });
    expect(countNewerSources(root, T0.getTime())).toBe(2);
  });

  it("returns 0 for an empty project", () => {
    expect(countNewerSources(project({}), T0.getTime())).toBe(0);
  });
});

describe("scope record", () => {
  it("reports the scope that produced the current snapshot", () => {
    const root = project({ ".metrics/crap.edn": T0 });
    writeScope(root, "crapper", { paths: ["src", "lib"] }, T0.getTime());
    expect(readScope(root, "crapper", T0.getTime())).toBe("src lib");
    writeScope(root, "crapper", { paths: [] }, T0.getTime());
    expect(readScope(root, "crapper", T0.getTime())).toBe("whole project");
    writeScope(root, "crapper", { paths: [], notes: ["(git changes)"] }, T0.getTime());
    expect(readScope(root, "crapper", T0.getTime())).toBe("whole project (git changes)");
  });

  it("reports unknown when the snapshot was rewritten outside the AXI", () => {
    const root = project({});
    expect(readScope(root, "crapper", T0.getTime())).toBe("unknown");
    writeScope(root, "crapper", { paths: ["src"] }, T0.getTime());
    expect(readScope(root, "crapper", T1.getTime())).toBe("unknown");
  });

  it("returns the run's details only for the snapshot it produced", () => {
    const root = project({});
    expect(readScopeDetails(root, "dryer", T0.getTime())).toBeNull();
    writeScope(root, "dryer", { paths: [], details: { threshold: 0.9 } }, T0.getTime());
    expect(readScopeDetails(root, "dryer", T0.getTime())).toEqual({ threshold: 0.9 });
    expect(readScopeDetails(root, "dryer", T1.getTime())).toBeNull();
  });

  it("treats a corrupt scope record as unknown", () => {
    const root = project({ ".metrics/axi/crapper.json": T0 });
    expect(readScope(root, "crapper", T0.getTime())).toBe("unknown");
    for (const text of [
      "null",
      '{"paths":"src","snapshotMtimeMs":0}',
      '{"paths":[1],"snapshotMtimeMs":0}',
    ]) {
      writeFileSync(join(root, ".metrics/axi/crapper.json"), text);
      expect(readScope(root, "crapper", 0)).toBe("unknown");
    }
  });

  it("ignores malformed notes and non-numeric details", () => {
    const root = project({});
    writeScope(root, "dryer", { paths: [] }, 0);
    writeFileSync(
      join(root, ".metrics/axi/dryer.json"),
      '{"paths":[],"notes":"x","details":{"threshold":"0.8","n":2},"snapshotMtimeMs":0}',
    );
    expect(readScope(root, "dryer", 0)).toBe("whole project");
    expect(readScopeDetails(root, "dryer", 0)).toEqual({ n: 2 });
    writeFileSync(
      join(root, ".metrics/axi/dryer.json"),
      '{"paths":[],"notes":["(a)",3],"snapshotMtimeMs":0}',
    );
    expect(readScope(root, "dryer", 0)).toBe("whole project (a)");
  });
});
