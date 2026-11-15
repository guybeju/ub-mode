# ub-mode AXIs

Agent-facing CLIs ([AXI](https://github.com/kunchenguid/axi)) for the quality-gate tools that
[ub-mode](https://github.com/unclebob/ub-mode) uses:

| CLI | Wraps | Gate |
| --- | --- | --- |
| `crapper-axi` | [crapper](https://github.com/unclebob/crapper) | every function under CRAP 10 |
| `dryer-axi` | [dryer](https://github.com/unclebob/dryer) | no duplicate pair at similarity 0.8 or above |
| `mutator-axi` | [mutator](https://github.com/unclebob/mutator) | zero surviving mutants |

Each prints [TOON](https://toonformat.dev/). With no arguments it summarizes the gate from the
tool's existing `.metrics/` snapshot without running anything; `run` analyzes, then summarizes;
`list` shows the detail; `skill` prints its Agent Skill.

```text
$ crapper-axi
bin: ~/.local/bin/crapper-axi
description: "CRAP scores (complexity x coverage) per function, gated at CRAP < 10"
snapshot:
  path: .metrics/crap.edn
  written: "2026-11-15T17:24:59.566Z"
  scope: whole project
  stale: no
gate: fail
functions: "4 total, 1 at CRAP >= 10, 0 ungraded"
over[1]{crap,coverage,function}:
  31.28,11.1%,demo.board.score
help[2]: Run `crapper-axi run <path>` after splitting or testing a flagged function,Run `crapper-axi list` for all 4 functions
```

Exit codes: 0 when the command answered (a failing gate is reported in the output), 1 on an
error such as `TOOL_MISSING`, `TOOL_FAILED`, `SNAPSHOT_INVALID` or `BASELINE_FAILED`, 2 on a usage
error such as an unknown flag.

## Install

Requirements: Node 22, pnpm, Python 3 with `venv`, and git.

```sh
# The wrapped tools (mutator needs crapper beside it)
mkdir -p ~/.local/share/unclebob && cd ~/.local/share/unclebob
for t in crapper dryer mutator; do git clone https://github.com/unclebob/$t.git; done
for t in crapper dryer mutator; do
  printf '#!/bin/sh\nexec "%s/%s/%s" "$@"\n' "$PWD" "$t" "$t" > ~/.local/bin/$t
  chmod +x ~/.local/bin/$t
done

# The AXIs
git clone https://github.com/guybeju/ub-mode.git ~/ub-mode && cd ~/ub-mode/axi
pnpm install && pnpm run build
for t in crapper dryer mutator; do
  ln -sf "$PWD/packages/$t-axi/bin/$t-axi.js" ~/.local/bin/$t-axi
  ln -sfn "$PWD/packages/$t-axi/skill" ~/.claude/skills/$t-axi   # optional Agent Skill
done
```

Set `CRAPPER_AXI_TOOL`, `DRYER_AXI_TOOL` or `MUTATOR_AXI_TOOL` to use a tool that is not on PATH.

## What the analyzed project needs

The wrapped tools find tests and coverage on their own. Two project setups make them report
numbers that look valid but are not; the AXIs print a `warning:` line when they see the symptom.

**Coverage must reach crapper** (symptom: every function at 0% coverage). crapper runs the
`coverage` or `test` script of the package.json nearest each source file, and reads LCOV only
from `coverage/**/lcov.info` or `target/coverage/**/lcov.info` under the directory it runs in.
In a pnpm workspace, give each package a script that writes there, for example:

```json
"coverage": "vitest run --root ../.. --coverage.enabled --coverage.reporter=lcov --coverage.include=packages/core/src/** --coverage.reportsDirectory=coverage/core packages/core/"
```

For Python, mark the project for pytest (`pyproject.toml` with `[tool.pytest.ini_options]`) and
have pytest and coverage in the project's `.venv`.

**Tests must load the mutated copy** (symptom: mutants survive and none is killed). mutator runs
each mutant in a worker directory where only the mutated file is a real copy and everything else
is a symlink. A test that resolves its imports through the real path loads the original file:

- TypeScript with `#` subpath or package imports: set `resolve.preserveSymlinks: true` in the
  vitest config. (mutator copies relative importers itself.)
- Python: do not build `sys.path` from `Path(__file__).resolve()`; use pytest's `pythonpath`.

## Files written into the analyzed project

Besides the tools' own `.metrics/` snapshots, `run` writes `.metrics/axi/<tool>.json`: the paths
and options of the run that produced the current snapshot. crapper and dryer replace their whole
snapshot on a scoped run, so this record is how the summary says `scope: src/billing` instead of
presenting a partial snapshot as the project. dryer's gate reads `ungraded` unless the record
shows the snapshot was filtered at 0.8 or lower.

## Development

```sh
pnpm install
pnpm run check     # format, lint, types, tests, build, skill freshness
pnpm run skills    # regenerate packages/*/skill/SKILL.md after changing help text
```

The repo passes its own gates: `crapper-axi run packages`, `dryer-axi run packages` and
`mutator-axi run packages`. Design decisions are in `DESIGN.md`.
