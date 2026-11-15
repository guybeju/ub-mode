import { AxiError } from "axi-sdk-js";

export type FlagKind = "boolean" | "number" | "string";
export type FlagValue = boolean | number | string;

export interface FlagSpec {
  command: string;
  bin: string;
  flags: Record<string, { kind: FlagKind }>;
  positionals: "none" | "one" | "many";
}

export interface ParsedFlags {
  flags: Record<string, FlagValue>;
  positionals: string[];
}

function usage(message: string, suggestion: string): AxiError {
  return new AxiError(message, "VALIDATION_ERROR", [suggestion]);
}

function helpHint(spec: FlagSpec): string {
  return `Run \`${spec.bin} ${spec.command} --help\``;
}

function convert(name: string, kind: FlagKind, raw: string, spec: FlagSpec): FlagValue {
  if (kind === "string") return raw;
  const value = Number(raw);
  if (raw.trim() === "" || !Number.isFinite(value)) {
    throw usage(`${name} must be a number, got ${raw}`, helpHint(spec));
  }
  return value;
}

function checkPositionals(positionals: string[], spec: FlagSpec): void {
  if (spec.positionals === "none" && positionals.length > 0) {
    throw usage(`unexpected argument ${positionals[0]} for \`${spec.command}\``, helpHint(spec));
  }
  if (spec.positionals === "one" && positionals.length !== 1) {
    throw usage(`\`${spec.command}\` needs exactly one path argument`, helpHint(spec));
  }
}

function declaredKind(name: string, parsed: ParsedFlags, spec: FlagSpec): FlagKind {
  const declared = spec.flags[name];
  if (!declared) {
    const valid = Object.keys(spec.flags).join(", ");
    throw usage(
      `unknown flag ${name} for \`${spec.command}\``,
      `valid flags for \`${spec.command}\`: ${valid}`,
    );
  }
  if (name in parsed.flags) {
    throw usage(`${name} given twice`, helpHint(spec));
  }
  return declared.kind;
}

/** Reads one flag into `parsed`; returns true when it consumed `next` as its value. */
function readFlag(
  arg: string,
  next: string | undefined,
  parsed: ParsedFlags,
  spec: FlagSpec,
): boolean {
  const eq = arg.indexOf("=");
  const name = eq === -1 ? arg : arg.slice(0, eq);
  const kind = declaredKind(name, parsed, spec);
  if (kind === "boolean") {
    if (eq !== -1) throw usage(`${name} takes no value`, helpHint(spec));
    parsed.flags[name] = true;
    return false;
  }
  if (eq !== -1) {
    parsed.flags[name] = convert(name, kind, arg.slice(eq + 1), spec);
    return false;
  }
  if (next === undefined || next.startsWith("--")) {
    throw usage(`${name} needs a value`, helpHint(spec));
  }
  parsed.flags[name] = convert(name, kind, next, spec);
  return true;
}

/**
 * Parses a subcommand's arguments against its declared flags.
 *
 * Every rejection is an AxiError with code VALIDATION_ERROR, which the SDK maps to exit 2.
 *
 * Args:
 *   args: Arguments after the subcommand name.
 *   spec: The subcommand's flags and positional rule.
 */
export function parseFlags(args: string[], spec: FlagSpec): ParsedFlags {
  const parsed: ParsedFlags = { flags: {}, positionals: [] };
  let valueTaken = false;
  args.forEach((arg, i) => {
    if (valueTaken) {
      valueTaken = false;
    } else if (arg.startsWith("--")) {
      valueTaken = readFlag(arg, args[i + 1], parsed, spec);
    } else {
      parsed.positionals.push(arg);
    }
  });
  checkPositionals(parsed.positionals, spec);
  return parsed;
}
