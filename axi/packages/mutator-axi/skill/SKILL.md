---
name: mutator-axi
description: >
  Mutation testing survivors and coverage gaps, gated at zero survivors. Use when running ub-mode's mutator step or checking this gate in a project.
---

# mutator-axi

Run `mutator-axi` with no arguments in the project root for the gate summary from `.metrics/mutate`.

```
usage: mutator-axi [command] [flags]
commands:
  (none)  summarize .metrics/mutate and the zero-survivor gate
  run     run mutation testing, then summarize
  list    list survivors, or uncovered sites with --uncovered
```

## mutator-axi run [paths..]

```
command: "run [paths..]"
description: Run mutator (mutation testing against the project's tests) and summarize
flags:
  "--changed": only files with git additions or edits
  "--mutate-all": rerun killed mutants too
  "--max-workers N": "parallel workers, default one per core"
examples[2]: mutator-axi run src/demo/board.py,mutator-axi run --changed
```

## mutator-axi list

```
command: list
description: List surviving mutants (default) or functions with uncovered sites
flags:
  "--survived": surviving mutants (default)
  "--uncovered": uncovered sites per function
examples[2]: mutator-axi list,mutator-axi list --uncovered
```

