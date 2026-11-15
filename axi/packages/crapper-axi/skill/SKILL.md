---
name: crapper-axi
description: >
  CRAP scores (complexity x coverage) per function, gated at CRAP < 10. Use when running ub-mode's crapper step or checking this gate in a project.
---

# crapper-axi

Run `crapper-axi` with no arguments in the project root for the gate summary from `.metrics/crap.edn`.

```
usage: crapper-axi [command] [flags]
commands:
  (none)  summarize .metrics/crap.edn and the CRAP < 10 gate
  run     run the analysis, then summarize
  list    list all functions worst first
```

## crapper-axi run [paths..]

```
command: "run [paths..]"
description: "Run crapper (complexity, coverage via the project's tests) and summarize"
flags:
  "--changed": only files with git additions or edits
  "--no-coverage": complexity only; CRAP is ungraded
  "--threshold N": "gate threshold, default 10 (fails at >= N)"
examples[3]: crapper-axi run,crapper-axi run src/billing,crapper-axi run --changed
```

## crapper-axi list

```
command: list
description: "List every function in the snapshot, worst CRAP first"
flags:
  "--over N": only functions at CRAP >= N
  "--fields complexity": add columns (complexity)
examples[2]: crapper-axi list,crapper-axi list --over 10 --fields complexity
```

