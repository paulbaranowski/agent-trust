import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import type { AgentTrustedDir, AgentTrustDirResult } from "../types.ts";
import { canonicalizeWorkspacePath, isPlainObject, writeFileAtomic } from "./shared.ts";

interface ClaudeProjectEntry {
  hasTrustDialogAccepted?: boolean;
  hasCompletedProjectOnboarding?: boolean;
  [key: string]: unknown;
}

interface ClaudeJsonFile {
  projects?: Record<string, ClaudeProjectEntry>;
  [key: string]: unknown;
}

type ClaudeJsonReadResult =
  | { ok: true; value: ClaudeJsonFile; missing: boolean }
  | { ok: false; error: string };

function claudeJsonPath(homeDir: string): string {
  return path.join(homeDir, ".claude.json");
}

/** Read `~/.claude.json`; refuse corrupt / non-object roots and invalid `projects`. */
function readClaudeJsonFile(jsonPath: string): ClaudeJsonReadResult {
  if (!existsSync(jsonPath)) {
    return { ok: true, value: {}, missing: true };
  }
  let raw: string;
  try {
    raw = readFileSync(jsonPath, "utf8");
  } catch (error) {
    return {
      ok: false,
      error: `agent-trust: could not read Claude trust config (${String(error)})`,
    };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    return {
      ok: false,
      error: `agent-trust: corrupt Claude trust config at ${jsonPath} (${String(error)})`,
    };
  }
  if (!isPlainObject(parsed)) {
    return {
      ok: false,
      error: `agent-trust: Claude trust config at ${jsonPath} must be a JSON object`,
    };
  }
  const projects = parsed["projects"];
  if (projects !== undefined && !isPlainObject(projects)) {
    return {
      ok: false,
      error: `agent-trust: Claude trust config at ${jsonPath} has invalid projects field`,
    };
  }
  return { ok: true, value: parsed, missing: false };
}

function writeClaudeJsonFile(jsonPath: string, contents: ClaudeJsonFile): void {
  writeFileAtomic(jsonPath, `${JSON.stringify(contents, undefined, 2)}\n`);
}

function findClaudeProjectKey(
  projects: Record<string, ClaudeProjectEntry>,
  workspacePath: string,
): string | undefined {
  const resolved = canonicalizeWorkspacePath(workspacePath);
  if (Object.hasOwn(projects, workspacePath)) {
    return workspacePath;
  }
  for (const key of Object.keys(projects)) {
    if (canonicalizeWorkspacePath(key) === resolved) {
      return key;
    }
  }
  return undefined;
}

/** True for drive-letter or UNC paths that Claude may match in either slash form. */
function looksWindowsPath(workspacePath: string): boolean {
  return /^[A-Za-z]:[\\/]/.test(workspacePath) || workspacePath.startsWith("\\\\");
}

function claudeTrustKeysForWorkspace(workspacePath: string): string[] {
  if (looksWindowsPath(workspacePath)) {
    const native = workspacePath;
    const forward = workspacePath.replace(/\\/g, "/");
    return native === forward ? [native] : [native, forward];
  }
  return [canonicalizeWorkspacePath(workspacePath)];
}

function projectEntryTrusted(
  projects: Record<string, ClaudeProjectEntry>,
  keys: string[],
): boolean {
  return keys.some((key) => projects[key]?.hasTrustDialogAccepted === true);
}

export function ensureClaudeTrust(input: {
  workspacePath: string;
  homeDir: string;
  trustMethod: string;
}): AgentTrustDirResult {
  const trustKeys = claudeTrustKeysForWorkspace(input.workspacePath);
  const absoluteWorkspacePath = trustKeys[0] ?? canonicalizeWorkspacePath(input.workspacePath);
  const jsonPath = claudeJsonPath(input.homeDir);
  const read = readClaudeJsonFile(jsonPath);
  if (!read.ok) {
    return {
      ok: false,
      status: "error",
      error: read.error,
      agent: "claude",
      dirPath: absoluteWorkspacePath,
    };
  }
  const claudeJson = read.value;
  const projects = claudeJson.projects ?? {};

  // Prefer an existing alias key for POSIX paths; Windows dual-keys are explicit.
  if (!looksWindowsPath(input.workspacePath)) {
    const projectKey = findClaudeProjectKey(projects, absoluteWorkspacePath);
    const existing = projectKey === undefined ? undefined : projects[projectKey];
    if (existing?.hasTrustDialogAccepted === true) {
      return {
        ok: true,
        status: "already-trusted",
        agent: "claude",
        dirPath: absoluteWorkspacePath,
      };
    }
    const keyToWrite = projectKey ?? absoluteWorkspacePath;
    projects[keyToWrite] = {
      ...existing,
      hasTrustDialogAccepted: true,
      hasCompletedProjectOnboarding: true,
    };
  } else {
    if (projectEntryTrusted(projects, trustKeys)) {
      return {
        ok: true,
        status: "already-trusted",
        agent: "claude",
        dirPath: absoluteWorkspacePath,
      };
    }
    for (const key of trustKeys) {
      const existing = projects[key];
      projects[key] = {
        ...existing,
        hasTrustDialogAccepted: true,
        hasCompletedProjectOnboarding: true,
      };
    }
  }
  claudeJson.projects = projects;

  try {
    writeClaudeJsonFile(jsonPath, claudeJson);
  } catch (error) {
    return {
      ok: false,
      status: "error",
      error: `agent-trust: could not seed Claude workspace trust for ${absoluteWorkspacePath} (${String(error)})`,
      agent: "claude",
      dirPath: absoluteWorkspacePath,
    };
  }

  return {
    ok: true,
    status: "trusted",
    agent: "claude",
    dirPath: absoluteWorkspacePath,
  };
}

export function listClaudeTrustEntries(homeDir: string): AgentTrustedDir[] {
  const jsonPath = claudeJsonPath(homeDir);
  const read = readClaudeJsonFile(jsonPath);
  if (!read.ok) {
    return [];
  }
  const projects = read.value.projects ?? {};
  const entries: AgentTrustedDir[] = [];
  // On-disk Claude stores key projects by absolute path.
  for (const [projectPath, project] of Object.entries(projects)) {
    if (project.hasTrustDialogAccepted !== true) {
      continue;
    }
    entries.push({
      agent: "claude",
      dirPath: canonicalizeWorkspacePath(projectPath),
      detail: "hasTrustDialogAccepted",
      store: `${jsonPath}#projects`,
    });
  }
  return entries.toSorted((a, b) => a.dirPath.localeCompare(b.dirPath));
}

export function deleteClaudeTrustEntry(homeDir: string, workspacePath: string): boolean {
  const jsonPath = claudeJsonPath(homeDir);
  const read = readClaudeJsonFile(jsonPath);
  if (!read.ok) {
    return false;
  }
  const claudeJson = read.value;
  const projects = claudeJson.projects ?? {};
  const projectKey = findClaudeProjectKey(projects, workspacePath);
  if (projectKey === undefined) {
    return false;
  }
  const existing = projects[projectKey];
  if (existing?.hasTrustDialogAccepted !== true) {
    return false;
  }

  const {
    hasTrustDialogAccepted: _trust,
    hasCompletedProjectOnboarding: _onboarding,
    ...rest
  } = existing;
  if (Object.keys(rest).length === 0) {
    const { [projectKey]: _removed, ...remainingProjects } = projects;
    claudeJson.projects = remainingProjects;
  } else {
    projects[projectKey] = rest;
    claudeJson.projects = projects;
  }
  writeClaudeJsonFile(jsonPath, claudeJson);
  return true;
}
