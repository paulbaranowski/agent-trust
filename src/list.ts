import { existsSync } from "node:fs";
import { homedir } from "node:os";

import { listClaudeTrustEntries } from "./agents/claude.ts";
import { listCodexTrustEntries } from "./agents/codex.ts";
import { listCursorTrustEntries } from "./agents/cursor.ts";
import { resolveHomeDir } from "./agents/shared.ts";
import type { AgentTrustAgent, AgentTrustEntry } from "./types.ts";

export interface ListInput {
  agent?: AgentTrustAgent;
  homeDir?: string;
  /** When true, only return entries whose workspace path no longer exists. */
  missingOnly?: boolean;
  /** Test seam for `os.homedir()` failures. */
  readHome?: () => string;
}

function workspacePathExists(workspacePath: string): boolean {
  try {
    return existsSync(workspacePath);
  } catch {
    return false;
  }
}

/** Whether the trusted workspace path no longer exists on disk. */
export function isMissingAgentTrustEntry(entry: AgentTrustEntry): boolean {
  return !workspacePathExists(entry.workspacePath);
}

/** Collect trust entries for a resolved home directory. Internal helper for list/untrust/prune. */
export function collectTrustEntries(input: {
  homeDir: string;
  agent?: AgentTrustAgent;
  missingOnly?: boolean;
}): AgentTrustEntry[] {
  const agents: AgentTrustAgent[] =
    input.agent === undefined ? ["cursor", "claude", "codex"] : [input.agent];
  const entries: AgentTrustEntry[] = [];
  if (agents.includes("cursor")) {
    entries.push(...listCursorTrustEntries(input.homeDir));
  }
  if (agents.includes("claude")) {
    entries.push(...listClaudeTrustEntries(input.homeDir));
  }
  if (agents.includes("codex")) {
    entries.push(...listCodexTrustEntries(input.homeDir));
  }
  const filtered =
    input.missingOnly === true ? entries.filter(isMissingAgentTrustEntry) : entries;
  return filtered.toSorted((a, b) => {
    const agentOrder = a.agent.localeCompare(b.agent);
    return agentOrder === 0 ? a.workspacePath.localeCompare(b.workspacePath) : agentOrder;
  });
}

/** List workspace trust entries recorded for Cursor, Claude, and Codex. */
export function list(input: ListInput = {}): AgentTrustEntry[] {
  const home = resolveHomeDir(input.homeDir, input.readHome ?? homedir);
  if (home === undefined) {
    return [];
  }
  return collectTrustEntries({
    homeDir: home,
    ...(input.agent === undefined ? {} : { agent: input.agent }),
    ...(input.missingOnly === undefined ? {} : { missingOnly: input.missingOnly }),
  });
}
