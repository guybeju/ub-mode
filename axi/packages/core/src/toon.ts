import { encode } from "@toon-format/toon";

/** Renders a structured help or data block as TOON, newline-terminated, for direct writes. */
export function toToon(output: Record<string, unknown>): string {
  return `${encode(output)}\n`;
}
