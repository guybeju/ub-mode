/**
 * Reader for the EDN subset that crapper, dryer and mutator write: nil, booleans,
 * numbers, strings, keywords, vectors and maps whose keys are keywords or strings.
 * Map keys become plain object keys with the keyword colon dropped.
 */

export class Keyword {
  constructor(readonly name: string) {}
}

export type Edn = null | boolean | number | string | Keyword | Edn[] | EdnMap;
export type EdnMap = { [key: string]: Edn };

const DELIMITERS = new Set(["[", "]", "{", "}", '"', ";"]);

const END = "";

/** Reads with `charAt`, which yields END past the last character instead of undefined. */
class Reader {
  private index = 0;

  constructor(private readonly text: string) {}

  readDocument(): Edn {
    const value = this.readForm();
    this.skipWhitespace();
    if (this.peek() !== END) {
      throw new Error(`unexpected trailing input at offset ${this.index}`);
    }
    return value;
  }

  private peek(): string {
    return this.text.charAt(this.index);
  }

  private readForm(): Edn {
    this.skipWhitespace();
    switch (this.peek()) {
      case END:
        throw new Error("unexpected end of input");
      case "[":
        return this.readVector();
      case "{":
        return this.readMap();
      case '"':
        return this.readString();
      case ":":
        this.index += 1;
        return new Keyword(this.readToken());
      default:
        return this.readAtom();
    }
  }

  private readVector(): Edn[] {
    this.index += 1;
    const items: Edn[] = [];
    while (!this.atClose("]")) {
      items.push(this.readForm());
    }
    return items;
  }

  private readMap(): EdnMap {
    this.index += 1;
    const map: EdnMap = {};
    while (!this.atClose("}")) {
      const key = mapKey(this.readForm());
      if (this.atClose("}")) {
        throw new Error("map has an odd number of forms");
      }
      map[key] = this.readForm();
    }
    return map;
  }

  private atClose(close: string): boolean {
    this.skipWhitespace();
    if (this.peek() !== close) return false;
    this.index += 1;
    return true;
  }

  private readString(): string {
    this.index += 1;
    let out = "";
    for (let ch = this.peek(); ch !== '"'; ch = this.peek()) {
      if (ch === END) throw new Error("unterminated string");
      this.index += 1;
      if (ch === "\\") {
        const escaped = this.peek();
        this.index += 1;
        out += unescape(escaped);
      } else {
        out += ch;
      }
    }
    this.index += 1;
    return out;
  }

  private readAtom(): Edn {
    const token = this.readToken();
    if (token === "nil") return null;
    if (token === "true") return true;
    if (token === "false") return false;
    if (!/^-?\d+(\.\d+)?([eE][-+]?\d+)?$/.test(token)) {
      throw new Error(`unsupported EDN form ${JSON.stringify(token)} at offset ${this.index}`);
    }
    const number = Number(token);
    if (!Number.isFinite(number)) {
      throw new Error(`number out of range ${token} at offset ${this.index}`);
    }
    return number;
  }

  private readToken(): string {
    const start = this.index;
    while (!this.atBoundary()) {
      this.index += 1;
    }
    if (this.index === start) {
      throw new Error(`unsupported EDN form at offset ${start}`);
    }
    return this.text.slice(start, this.index);
  }

  private atBoundary(): boolean {
    const ch = this.peek();
    return ch === END || isWhitespace(ch) || DELIMITERS.has(ch);
  }

  private skipWhitespace(): void {
    while (isWhitespace(this.peek())) {
      this.index += 1;
    }
  }
}

/** `\\n`, `\\t` and `\\r` are control characters; any other escaped character stands for itself. */
function unescape(ch: string): string {
  switch (ch) {
    case "n":
      return "\n";
    case "t":
      return "\t";
    case "r":
      return "\r";
    default:
      return ch;
  }
}

function isWhitespace(ch: string): boolean {
  return ch === "," || /^\s$/.test(ch);
}

function mapKey(key: Edn): string {
  if (key instanceof Keyword) return key.name;
  if (typeof key === "string") return key;
  throw new Error("map key must be a keyword or string");
}

export function isEdnMap(value: Edn | undefined): value is EdnMap {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    !(value instanceof Keyword)
  );
}

/**
 * Returns `row[key]` when it passes `check`, otherwise throws `missing(key)`.
 *
 * Args:
 *   row: A parsed EDN map.
 *   key: The key without its keyword colon.
 *   check: Type guard the value must satisfy.
 *   missing: Builds the error for an absent or wrongly typed value.
 */
export function requireField<T extends Edn>(
  row: EdnMap,
  key: string,
  check: (v: Edn | undefined) => v is T,
  missing: (key: string) => Error,
): T {
  const value = row[key];
  if (!check(value)) throw missing(key);
  return value;
}

export function parseEdn(text: string): Edn {
  return new Reader(text).readDocument();
}
