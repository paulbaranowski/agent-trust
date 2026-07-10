import { styleText } from "node:util";

type StyleFormat = Parameters<typeof styleText>[0];

// styleText returns the text unchanged when stdout has no color support (not a
// TTY, or NO_COLOR set), so callers never branch on TTY detection themselves —
// and test assertions stay plain because vitest runs with a piped stdout.
function paint(format: StyleFormat, text: string): string {
  return styleText(format, text, { stream: process.stdout });
}

export function okMark(): string {
  return paint("green", "✓");
}

export function failMark(): string {
  return paint("red", "✗");
}

export function styleWarning(text: string): string {
  return paint("yellow", text);
}

export function styleDim(text: string): string {
  return paint("dim", text);
}
