import { AxiError } from "axi-sdk-js";
import { describe, expect, it } from "vitest";
import { parseFlags, type FlagSpec } from "#src/flags";

const SPEC: FlagSpec = {
  command: "run",
  bin: "crapper-axi",
  flags: {
    "--changed": { kind: "boolean" },
    "--threshold": { kind: "number" },
    "--fields": { kind: "string" },
  },
  positionals: "many",
};

function failure(args: string[], spec: FlagSpec = SPEC): AxiError {
  try {
    parseFlags(args, spec);
  } catch (error) {
    if (error instanceof AxiError) return error;
    throw error;
  }
  throw new Error("expected parseFlags to throw");
}

describe("parseFlags", () => {
  it("collects booleans, values and positionals in any order", () => {
    expect(parseFlags(["src", "--changed", "--threshold", "12.5", "lib"], SPEC)).toEqual({
      flags: { "--changed": true, "--threshold": 12.5 },
      positionals: ["src", "lib"],
    });
  });

  it("accepts --flag=value", () => {
    expect(parseFlags(["--fields=complexity", "src"], SPEC)).toEqual({
      flags: { "--fields": "complexity" },
      positionals: ["src"],
    });
  });

  it("rejects an unknown flag by name and lists the valid ones", () => {
    const error = failure(["--stat"]);
    expect(error.code).toBe("VALIDATION_ERROR");
    expect(error.message).toBe("unknown flag --stat for `run`");
    expect(error.suggestions).toEqual(["valid flags for `run`: --changed, --threshold, --fields"]);
  });

  it("rejects a missing or non-numeric value", () => {
    expect(failure(["--threshold"]).message).toBe("--threshold needs a value");
    expect(failure(["--threshold", "ten"]).message).toBe("--threshold must be a number, got ten");
  });

  it("rejects a value on a boolean flag", () => {
    expect(failure(["--changed=yes"]).message).toBe("--changed takes no value");
  });

  it("rejects a repeated flag", () => {
    expect(failure(["--changed", "--changed"]).message).toBe("--changed given twice");
  });

  it("enforces the positional rule", () => {
    const none: FlagSpec = { ...SPEC, positionals: "none" };
    expect(failure(["src"], none).message).toBe("unexpected argument src for `run`");
    expect(parseFlags(["--changed"], none).positionals).toEqual([]);
    const one: FlagSpec = { ...SPEC, positionals: "one" };
    expect(failure([], one).message).toBe("`run` needs exactly one path argument");
    expect(failure(["a", "b"], one).message).toBe("`run` needs exactly one path argument");
    expect(parseFlags(["a"], one).positionals).toEqual(["a"]);
  });

  it("points help at the command", () => {
    expect(failure(["--nope"]).suggestions).toHaveLength(1);
    expect(failure(["--threshold"]).suggestions).toEqual(["Run `crapper-axi run --help`"]);
  });
});
