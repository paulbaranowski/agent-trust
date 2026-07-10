import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import type { AgentTrustEntry, TrustResult } from "../types.ts";
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

export function ensureClaudeTrust(input: {
  workspacePath: string;
  homeDir: string;
  trustMethod: string;
}): TrustResult {
  const absoluteWorkspacePath = path.resolve(input.workspacePath);
  const jsonPath = claudeJsonPath(input.homeDir);
  const claudeJson = readClaudeJsonFile(jsonPath);
  const projects = claudeJson.projects ?? {};
  const existing = projects[absoluteWorkspacePath];

  if (existing?.hasTrustDialogAccepted === true) {
    return {
      ok: true,
      status: "already-trusted",
      agent: "claude",
      workspacePath: absoluteWorkspacePath,
    };
  }

  projects[absoluteWorkspacePath] = {
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
      workspacePath: absoluteWorkspacePath,
    };
  }

  return {
    ok: true,
    status: "trusted",
    agent: "claude",
    workspacePath: absoluteWorkspacePath,
  };
}

export function listClaudeTrustEntries(homeDir: string): AgentTrustEntry[] {
  const jsonPath = claudeJsonPath(homeDir);
  const claudeJson = readClaudeJsonFile(jsonPath);
  const projects = claudeJson.projects ?? {};
  const entries: AgentTrustEntry[] = [];
  for (const [workspacePath, project] of Object.entries(projects)) {
    if (project.hasTrustDialogAccepted !== true) {
      continue;
    }
    entries.push({
      agent: "claude",
      workspacePath: path.resolve(workspacePath),
      detail: "hasTrustDialogAccepted",
      store: `${jsonPath}#projects`,
    });
  }
  return entries.toSorted((a, b) => a.workspacePath.localeCompare(b.workspacePath));
}

export function deleteClaudeTrustEntry(homeDir: string, workspacePath: string): boolean {
  const jsonPath = claudeJsonPath(homeDir);
  const claudeJson = readClaudeJsonFile(jsonPath);
  const projects = claudeJson.projects ?? {};
  const existing = projects[workspacePath];
  if (existing?.hasTrustDialogAccepted !== true) {
    return false;
  }

  const {
    hasTrustDialogAccepted: _trust,
    hasCompletedProjectOnboarding: _onboarding,
    ...rest
  } = existing;
  if (Object.keys(rest).length === 0) {
    const { [workspacePath]: _removed, ...remainingProjects } = projects;
    claudeJson.projects = remainingProjects;
  } else {
    projects[workspacePath] = rest;
    claudeJson.projects = projects;
  }
  writeClaudeJsonFile(jsonPath, claudeJson);
  return true;
}
