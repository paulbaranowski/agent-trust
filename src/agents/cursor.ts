import { existsSync, readdirSync, readFileSync, rmSync } from "node:fs";
import path from "node:path";

import type { AgentTrustedDir, AgentTrustDirResult } from "../types.ts";
import { canonicalizeWorkspacePath, isPlainObject, writeFileAtomic } from "./shared.ts";

interface CursorWorkspaceTrustedMarker {
  workspacePath?: string;
  trustMethod?: string;
}

/** True for drive-letter or UNC paths that must not go through POSIX resolve. */
function looksWindowsPath(workspacePath: string): boolean {
  return /^[A-Za-z]:[\\/]/.test(workspacePath) || workspacePath.startsWith("\\\\");
}

/** Normalize a resolved absolute path into Cursor's project slug (Orca-compatible). */
export function cursorProjectSlugFromResolved(resolvedPath: string): string {
  const stripped = resolvedPath.replace(/^[\\/]+/, "");
  return stripped.replace(/[\\/:*?"<>|]+/g, "-");
}

/** Cursor keys project metadata under `~/.cursor/projects/<slug>/`. */
export function cursorProjectSlug(workspacePath: string): string {
  // Windows-looking strings are slugified as-is so unit tests and cross-OS
  // callers are not mangled by POSIX path.resolve.
  const abs = looksWindowsPath(workspacePath)
    ? workspacePath
    : canonicalizeWorkspacePath(workspacePath);
  return cursorProjectSlugFromResolved(abs);
}

function cursorProjectsDir(homeDir: string): string {
  return path.join(homeDir, ".cursor", "projects");
}

function cursorWorkspaceTrustedPath(home: string, workspacePath: string): string {
  const slug = cursorProjectSlug(workspacePath);
  return path.join(home, ".cursor", "projects", slug, ".workspace-trusted");
}

export function ensureCursorTrust(input: {
  workspacePath: string;
  homeDir: string;
  trustMethod: string;
}): AgentTrustDirResult {
  const absoluteWorkspacePath = canonicalizeWorkspacePath(input.workspacePath);
  const markerPath = cursorWorkspaceTrustedPath(input.homeDir, input.workspacePath);
  if (existsSync(markerPath)) {
    let existing: CursorWorkspaceTrustedMarker | undefined;
    try {
      existing = parseCursorMarker(readFileSync(markerPath, "utf8"));
    } catch {
      existing = undefined;
    }
    const recordedPath = existing?.workspacePath;
    if (
      recordedPath === undefined ||
      canonicalizeWorkspacePath(recordedPath) === absoluteWorkspacePath
    ) {
      return {
        ok: true,
        status: "already-trusted",
        agent: "cursor",
        dirPath: absoluteWorkspacePath,
      };
    }
    // Same Cursor slug, different recorded path — rewrite the marker for this path.
  }

  const marker = {
    trustedAt: new Date().toISOString(),
    workspacePath: absoluteWorkspacePath,
    trustMethod: input.trustMethod,
  };

  try {
    writeFileAtomic(markerPath, `${JSON.stringify(marker, undefined, 2)}\n`);
  } catch (error) {
    return {
      ok: false,
      status: "error",
      error: `agent-trust: could not seed Cursor workspace trust for ${absoluteWorkspacePath} (${String(error)})`,
      agent: "cursor",
      dirPath: absoluteWorkspacePath,
    };
  }

  return {
    ok: true,
    status: "trusted",
    agent: "cursor",
    dirPath: absoluteWorkspacePath,
  };
}

function parseCursorMarker(raw: string): CursorWorkspaceTrustedMarker | undefined {
  try {
    const parsed: unknown = JSON.parse(raw);
    return isPlainObject(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

export function listCursorTrustEntries(homeDir: string): AgentTrustedDir[] {
  const projectsDir = cursorProjectsDir(homeDir);
  let slugs: string[];
  try {
    if (!existsSync(projectsDir)) {
      return [];
    }
    slugs = readdirSync(projectsDir);
  } catch {
    // Match Claude/Codex list readers: degrade to [] on permission / I/O failures.
    return [];
  }

  const entries: AgentTrustedDir[] = [];
  for (const slug of slugs) {
    const markerPath = path.join(projectsDir, slug, ".workspace-trusted");
    let raw: string;
    try {
      if (!existsSync(markerPath)) {
        continue;
      }
      raw = readFileSync(markerPath, "utf8");
    } catch {
      continue;
    }
    let dirPath = path.resolve(`/${slug.replaceAll("-", "/")}`);
    let detail = "trusted";
    const marker = parseCursorMarker(raw);
    if (marker === undefined) {
      detail = "trusted (unparseable marker)";
    } else {
      // On-disk Cursor markers still store the `workspacePath` key.
      if (typeof marker.workspacePath === "string") {
        dirPath = marker.workspacePath;
      }
      if (typeof marker.trustMethod === "string") {
        detail = marker.trustMethod;
      }
    }
    entries.push({
      agent: "cursor",
      dirPath: path.resolve(dirPath),
      detail,
      store: markerPath,
    });
  }
  return entries.toSorted((a, b) => a.dirPath.localeCompare(b.dirPath));
}

export function deleteCursorTrustEntry(markerPath: string): boolean {
  if (!existsSync(markerPath)) {
    return false;
  }
  rmSync(markerPath);
  return true;
}
