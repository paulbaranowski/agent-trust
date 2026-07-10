import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import type { AgentTrustedDir, AgentTrustDirResult } from "../types.ts";
import { isPlainObject, writeFileAtomic } from "./shared.ts";

interface ClaudeProjectEntry {
  hasTrustDialogAccepted?: boolean;
  hasCompletedProjectOnboarding?: boolean;
  [key: string]: unknown;
}

interface ClaudeJsonFile {
  projects?: Record<string, ClaudeProjectEntry>;
  [key: string]: unknown;
}

function claudeJsonPath(homeDir: string): string {
  return path.join(homeDir, ".claude.json");
}

/** Read `~/.claude.json`, recovering silently from malformed roots / projects fields. */
function readClaudeJsonFile(jsonPath: string): ClaudeJsonFile {
  try {
    const parsed: unknown = JSON.parse(readFileSync(jsonPath, "utf8"));
    if (!isPlainObject(parsed)) {
      return {};
    }
    const projects = parsed["projects"];
    if (projects !== undefined && !isPlainObject(projects)) {
      const { projects: _ignored, ...rest } = parsed;
      return rest;
    }
    return parsed;
  } catch {
    return {};
  }
}

function writeClaudeJsonFile(jsonPath: string, contents: ClaudeJsonFile): void {
  writeFileAtomic(jsonPath, `${JSON.stringify(contents, undefined, 2)}\n`);
}

function findClaudeProjectKey(
  projects: Record<string, ClaudeProjectEntry>,
  workspacePath: string,
): string | undefined {
  const resolved = path.resolve(workspacePath);
  if (Object.hasOwn(projects, workspacePath)) {
    return workspacePath;
  }
  for (const key of Object.keys(projects)) {
    if (path.resolve(key) === resolved) {
      return key;
    }
  }
  return undefined;
}

export function ensureClaudeTrust(input: {
  workspacePath: string;
  homeDir: string;
  trustMethod: string;
}): AgentTrustDirResult {
  const absoluteWorkspacePath = path.resolve(input.workspacePath);
  const jsonPath = claudeJsonPath(input.homeDir);
  const claudeJson = readClaudeJsonFile(jsonPath);
  const projects = claudeJson.projects ?? {};
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
  const claudeJson = readClaudeJsonFile(jsonPath);
  const projects = claudeJson.projects ?? {};
  const entries: AgentTrustedDir[] = [];
  // On-disk Claude stores key projects by absolute path.
  for (const [projectPath, project] of Object.entries(projects)) {
    if (project.hasTrustDialogAccepted !== true) {
      continue;
    }
    entries.push({
      agent: "claude",
      dirPath: path.resolve(projectPath),
      detail: "hasTrustDialogAccepted",
      store: `${jsonPath}#projects`,
    });
  }
  return entries.toSorted((a, b) => a.dirPath.localeCompare(b.dirPath));
}

export function deleteClaudeTrustEntry(homeDir: string, workspacePath: string): boolean {
  const jsonPath = claudeJsonPath(homeDir);
  const claudeJson = readClaudeJsonFile(jsonPath);
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
