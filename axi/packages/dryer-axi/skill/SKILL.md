---
name: dryer-axi
description: >
  Structural duplicate code candidates, gated at similarity < 0.8. Use when running ub-mode's dryer step or checking this gate in a project.
---

# dryer-axi

Run `dryer-axi` with no arguments in the project root for the gate summary from `.metrics/dry.edn`.

```
usage: dryer-axi [command] [flags]
commands:
  (none)  summarize .metrics/dry.edn and the similarity < 0.8 gate
  run     run the analysis, then summarize
  list    list all candidate pairs closest first
```

## dryer-axi run [paths..]

```
command: "run [paths..]"
description: Run dryer (structural duplicate detection) and summarize
flags:
  "--changed": only files with git additions or edits
  "--threshold N": "minimum similarity to report, default 0.8; the gate stays at 0.8"
  "--min-lines N": "minimum source lines in a candidate, default 4"
examples[3]: dryer-axi run,dryer-axi run src/billing,dryer-axi run --changed --min-lines 3
```

## dryer-axi list

```
command: list
description: "List every candidate pair in the snapshot, closest first"
flags:
  "--threshold N": only pairs at score >= N
examples[2]: dryer-axi list,dryer-axi list --threshold 0.9
```

