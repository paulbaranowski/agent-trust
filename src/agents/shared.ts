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

/** True for drive-letter or UNC paths that must not go through POSIX resolve. */
export function looksWindowsPath(workspacePath: string): boolean {
  return /^[A-Za-z]:[\\/]/.test(workspacePath) || workspacePath.startsWith("\\\\");
}

/**
 * Resolve a workspace path for trust keys: realpath when present on POSIX-like
 * paths; leave Windows drive/UNC strings intact so cross-OS unit tests and
 * Windows agents are not mangled by POSIX `path.resolve`.
 */
export function resolveWorkspaceTrustPath(workspacePath: string): string {
  if (looksWindowsPath(workspacePath)) {
    return workspacePath;
  }
  return canonicalizeWorkspacePath(workspacePath);
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

/** Resolve Codex config home: explicit override → `CODEX_HOME` → `~/.codex`. */
export function resolveCodexHome(input: {
  homeDir: string;
  codexHome?: string;
  env?: NodeJS.ProcessEnv;
}): string {
  if (input.codexHome !== undefined && input.codexHome.trim() !== "") {
    return path.resolve(input.codexHome);
  }
  const fromEnv = (input.env ?? process.env).CODEX_HOME;
  if (fromEnv !== undefined && fromEnv.trim() !== "") {
    return path.resolve(fromEnv);
  }
  return path.join(input.homeDir, ".codex");
}

/** Write `contents` to `filePath` atomically via a temp file + rename with mode 0o600. */
export function writeFileAtomic(filePath: string, contents: string): void {
  mkdirSync(path.dirname(filePath), { recursive: true });
  const tmpPath = `${filePath}.${process.pid}.tmp`;
  writeFileSync(tmpPath, contents, { mode: 0o600 });
  renameSync(tmpPath, filePath);
}
