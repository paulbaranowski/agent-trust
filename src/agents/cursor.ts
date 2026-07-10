import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";

import type { AgentTrustEntry, TrustResult } from "../types.ts";
import { isPlainObject } from "./shared.ts";

interface CursorWorkspaceTrustedMarker {
  workspacePath?: string;
  trustMethod?: string;
}

/** Cursor keys project metadata under `~/.cursor/projects/<slug>/`. */
export function cursorProjectSlug(workspacePath: string): string {
  return path.resolve(workspacePath).replace(/^\//, "").replaceAll("/", "-");
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
}): TrustResult {
  const absoluteWorkspacePath = path.resolve(input.workspacePath);
  const markerPath = cursorWorkspaceTrustedPath(input.homeDir, input.workspacePath);
  if (existsSync(markerPath)) {
    return {
      ok: true,
      status: "already-trusted",
      agent: "cursor",
      workspacePath: absoluteWorkspacePath,
    };
  }

  const marker = {
    trustedAt: new Date().toISOString(),
    workspacePath: absoluteWorkspacePath,
    trustMethod: input.trustMethod,
  };

  try {
    mkdirSync(path.dirname(markerPath), { recursive: true });
    writeFileSync(markerPath, `${JSON.stringify(marker, undefined, 2)}\n`, "utf8");
  } catch (error) {
    return {
      ok: false,
      status: "error",
      error: `agent-trust: could not seed Cursor workspace trust for ${absoluteWorkspacePath} (${String(error)})`,
      agent: "cursor",
      workspacePath: absoluteWorkspacePath,
    };
  }

  return {
    ok: true,
    status: "trusted",
    agent: "cursor",
    workspacePath: absoluteWorkspacePath,
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

export function listCursorTrustEntries(homeDir: string): AgentTrustEntry[] {
  const projectsDir = cursorProjectsDir(homeDir);
  if (!existsSync(projectsDir)) {
    return [];
  }

  const entries: AgentTrustEntry[] = [];
  for (const slug of readdirSync(projectsDir)) {
    const markerPath = path.join(projectsDir, slug, ".workspace-trusted");
    if (!existsSync(markerPath)) {
      continue;
    }
    let workspacePath = path.resolve(`/${slug.replaceAll("-", "/")}`);
    let detail = "trusted";
    const marker = parseCursorMarker(readFileSync(markerPath, "utf8"));
    if (marker === undefined) {
      detail = "trusted (unparseable marker)";
    } else {
      if (typeof marker.workspacePath === "string") {
        workspacePath = marker.workspacePath;
      }
      if (typeof marker.trustMethod === "string") {
        detail = marker.trustMethod;
      }
    }
    entries.push({
      agent: "cursor",
      workspacePath: path.resolve(workspacePath),
      detail,
      store: markerPath,
    });
  }
  return entries.toSorted((a, b) => a.workspacePath.localeCompare(b.workspacePath));
}

export function deleteCursorTrustEntry(markerPath: string): boolean {
  if (!existsSync(markerPath)) {
    return false;
  }
  rmSync(markerPath);
  return true;
}
