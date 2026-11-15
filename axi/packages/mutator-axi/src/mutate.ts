import { isEdnMap, Keyword, parseEdn, requireField, type Edn } from "@ub-axi/core/edn";

export interface Form {
  id: string;
  namespace: string;
  file: string;
  line: number;
  endLine: number;
  killed: number;
  survived: number;
  uncovered: number;
}

/** One executed mutant; `start` is the UTF-8 byte offset of the mutated text. */
export interface Outcome {
  file: string;
  namespace: string;
  formId: string;
  start: number;
  from: string;
  to: string;
  status: "killed" | "survived";
}

export interface MutateFile {
  forms: Form[];
  outcomes: Outcome[];
}

export interface MutateSummary {
  gate: "pass" | "fail" | "ungraded";
  killed: number;
  survived: number;
  uncovered: number;
}

const missingFormField = (key: string) => new Error(`form is missing :${key}`);

const isNumber = (v: Edn | undefined): v is number => typeof v === "number";
const isString = (v: Edn | undefined): v is string => typeof v === "string";

function readForm(row: Edn, namespace: string): Form {
  if (!isEdnMap(row)) throw new Error("form is not a map");
  return {
    id: requireField(row, "id", isString, missingFormField),
    namespace,
    file: requireField(row, "file", isString, missingFormField),
    line: requireField(row, "line", isNumber, missingFormField),
    endLine: requireField(row, "end-line", isNumber, missingFormField),
    killed: requireField(row, "killed", isNumber, missingFormField),
    survived: requireField(row, "survived", isNumber, missingFormField),
    uncovered: requireField(row, "uncovered", isNumber, missingFormField),
  };
}

function isMutationKey(
  value: unknown,
): value is [string, string, string, number, number, string, string] {
  if (!Array.isArray(value) || value.length !== 7) return false;
  const [file, ns, form, start, end, from, to] = value as unknown[];
  const strings = [file, ns, form, from, to].every((v) => typeof v === "string");
  return strings && typeof start === "number" && typeof end === "number";
}

function readOutcome(key: string, status: Edn): Outcome | null {
  let decoded: unknown;
  try {
    decoded = JSON.parse(key);
  } catch {
    decoded = null;
  }
  if (!isMutationKey(decoded)) throw new Error(`outcome key is not a mutation: ${key}`);
  if (!(status instanceof Keyword) || (status.name !== "killed" && status.name !== "survived")) {
    return null;
  }
  const [file, namespace, formId, start, , from, to] = decoded;
  return { file, namespace, formId, start, from, to, status: status.name };
}

/** Parses one `.metrics/mutate/<namespace>.edn` file. */
export function parseMutateFile(text: string): MutateFile {
  const root = parseEdn(text);
  if (!isEdnMap(root) || !Array.isArray(root["forms"])) {
    throw new Error("snapshot has no :forms vector");
  }
  const namespace = typeof root["namespace"] === "string" ? root["namespace"] : "";
  const outcomesMap = isEdnMap(root["outcomes"]) ? root["outcomes"] : {};
  const outcomes: Outcome[] = [];
  for (const [key, status] of Object.entries(outcomesMap)) {
    const outcome = readOutcome(key, status);
    if (outcome) outcomes.push(outcome);
  }
  return { forms: root["forms"].map((row) => readForm(row, namespace)), outcomes };
}

/** Surviving mutants in source order: by file, then by position. */
export function survivorsInOrder(outcomes: Outcome[]): Outcome[] {
  return outcomes
    .filter((o) => o.status === "survived")
    .sort((a, b) => a.file.localeCompare(b.file) || a.start - b.start);
}

/** Forms with uncovered mutation sites, most uncovered first. */
export function uncoveredForms(forms: Form[]): Form[] {
  return forms.filter((f) => f.uncovered > 0).sort((a, b) => b.uncovered - a.uncovered);
}

/** Applies the ub-mode gate: every executed mutant must be killed. */
export function summarize(forms: Form[]): MutateSummary {
  let killed = 0;
  let survived = 0;
  let uncovered = 0;
  for (const f of forms) {
    killed += f.killed;
    survived += f.survived;
    uncovered += f.uncovered;
  }
  let gate: MutateSummary["gate"] = "pass";
  if (survived > 0) gate = "fail";
  else if (killed === 0) gate = "ungraded";
  return { gate, killed, survived, uncovered };
}

/** `defn/place` in `demo.board` is `demo.board.place`; `defn-/x` is a private form. */
export function functionName(namespace: string, formId: string): string {
  const slash = formId.indexOf("/");
  const name = formId.slice(slash + 1);
  const label = namespace ? `${namespace}.${name}` : name;
  return formId.startsWith("defn-/") ? `${label} (private)` : label;
}

/** The 1-based line and character column of byte `offset` in a UTF-8 file. */
export function positionAt(bytes: Buffer, offset: number): { line: number; column: number } {
  const end = Math.min(offset, bytes.length);
  let line = 1;
  let lineStart = 0;
  for (let i = 0; i < end; i += 1) {
    if (bytes[i] === 0x0a) {
      line += 1;
      lineStart = i + 1;
    }
  }
  const column = bytes.subarray(lineStart, end).toString("utf8").length + 1;
  return { line, column };
}
