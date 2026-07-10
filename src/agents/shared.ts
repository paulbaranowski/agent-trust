import { existsSync, mkdirSync, realpathSync, renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

export function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Prefer realpath when the path exists so trust keys match Cursor/Codex lookups. */
export function canonicalizeWorkspacePath(workspacePath: string): string {
  const resolved = path.resolve(workspacePath);
  try {
    if (existsSync(resolved)) {
      return realpathSync.native(resolved);
    }
  } catch {
    // fall through
  }
  return resolved;
}

export function resolveHomeDir(
  homeDir: string | undefined,
  readHome: () => string = homedir,
): string | undefined {
  try {
    return homeDir ?? readHome();
  } catch {
    return undefined;
  }
}

/** Write `contents` to `filePath` atomically via a temp file + rename with mode 0o600. */
export function writeFileAtomic(filePath: string, contents: string): void {
  mkdirSync(path.dirname(filePath), { recursive: true });
  const tmpPath = `${filePath}.${process.pid}.tmp`;
  writeFileSync(tmpPath, contents, { mode: 0o600 });
  renameSync(tmpPath, filePath);
}
