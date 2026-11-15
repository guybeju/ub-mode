# Design

AXI (https://github.com/kunchenguid/axi) wrappers for the ub-mode quality-gate tools
by Robert C. Martin: crapper, dryer, mutator.

## Decisions

1. Three independent CLIs: `crapper-axi`, `dryer-axi`, `mutator-axi`.
2. TypeScript on Node 22 with `axi-sdk-js`.
3. One pnpm workspace repo: `packages/crapper-axi`, `packages/dryer-axi`,
   `packages/mutator-axi`, plus a shared core (EDN snapshot parsing, running the wrapped
   tool, translating its failures into AXI structured errors).
4. The no-argument home view reads the existing `.metrics/` snapshot only. It never runs
   tests. It reports snapshot age and whether sources are newer than the snapshot. With no
   snapshot it says so and suggests `run`.
5. The wrapped tool is found on PATH (`crapper`, `dryer`, `mutator`), overridable by an
   environment variable. Missing tool or a broken Python environment is a structured
   error with install steps. The AXI does not install the wrapped tools.
6. No session hooks. Each CLI ships a SKILL.md generated from its home-view content.
7. Commands:
   - `crapper-axi` | `run [paths..] [--changed] [--no-coverage] [--threshold N]` |
     `list [--over N] [--fields ...]`. Default threshold CRAP 10.
   - `dryer-axi` | `run [paths..] [--changed] [--threshold N] [--min-lines N]` |
     `list [--threshold N]`. Default threshold 0.8.
   - `mutator-axi` | `run <path> [--changed] [--mutate-all] [--max-workers N]` |
     `list [--survived|--uncovered]`. Gate: zero survivors.
   - All: `-v/--version` fast path, per-subcommand `--help`, unknown flag exits 2.
8. Exit codes follow AXI: 0 when the analysis ran (gate pass or fail is stated in the
   output), 1 error, 2 usage error. A CI gate that needs a non-zero exit is not served yet.

## Additions made while building

- **Scope record.** `run` writes `.metrics/axi/<tool>.json` in the analyzed project:
  the paths, notes such as `(git changes)`, and details such as the dryer threshold,
  keyed to the snapshot's mtime. The home view shows `scope: unknown` when the snapshot
  was rewritten outside the AXI. crapper and dryer replace their whole snapshot on a
  scoped run, so this is the only way to tell a partial snapshot from a full one.
- **Mutator snapshot** is merged per file by the tool, so its scope reads
  "merged per file across runs" and no record is written.
- **Survivor positions** are `file:line:column`, computed from mutator's UTF-8 byte offsets.
- **Errors.** `TOOL_MISSING` (with clone and PATH steps), `TOOL_FAILED` (with the tool's
  last stderr lines), `SNAPSHOT_INVALID`, and mutator's `BASELINE_FAILED` when the
  project's tests fail before any mutation.
- **Dryer gate** is `ungraded` unless the snapshot was produced at threshold 0.8 or lower,
  because dryer's snapshot keeps only pairs above the threshold of its run.
- **Skills.** Each CLI has a `skill` command that prints its SKILL.md from the same
  description and help it shows; `pnpm run check` fails if `skill/SKILL.md` is stale.
- **Coverage for crapper.** Each package has `test` and `coverage` scripts writing
  `coverage/<pkg>/lcov.info` at the repo root, which is where crapper looks.
- **Mutation testing.** vitest runs with `resolve.preserveSymlinks`, so mutator's
  symlinked workers load the mutated file through `#src/*` imports.
