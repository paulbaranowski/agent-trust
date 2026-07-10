import { accessSync, constants } from "node:fs";
import { homedir } from "node:os";

import { listClaudeTrustEntries } from "./agents/claude.ts";
import { listCodexTrustEntries } from "./agents/codex.ts";
import { listCursorTrustEntries } from "./agents/cursor.ts";
import { resolveHomeDir } from "./agents/shared.ts";
import type { AgentTrustAgent, AgentTrustedDir } from "./types.ts";

export interface ListAgentTrustedDirsInput {
  agent?: AgentTrustAgent;
  homeDir?: string;
  /** When true, only return entries whose directory path no longer exists. */
  missingOnly?: boolean;
  /** Test seam for `os.homedir()` failures. */
  readHome?: () => string;
}

/** True only when the path is confirmed absent (ENOENT). Other I/O errors are not "missing". */
function isAbsentDirPath(dirPath: string): boolean {
  try {
    accessSync(dirPath, constants.F_OK);
    return false;
  } catch (error) {
    return (
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      (error as { code?: unknown }).code === "ENOENT"
    );
  }
}

/** Whether the trusted directory path no longer exists on disk. */
export function isMissingAgentTrustedDir(entry: AgentTrustedDir): boolean {
  return isAbsentDirPath(entry.dirPath);
}

/** Collect trusted dirs for a resolved home directory. Internal helper for list/untrust/prune. */
export function collectTrustEntries(input: {
  homeDir: string;
  agent?: AgentTrustAgent;
  missingOnly?: boolean;
}): AgentTrustedDir[] {
  const agents: AgentTrustAgent[] =
    input.agent === undefined ? ["cursor", "claude", "codex"] : [input.agent];
  const entries: AgentTrustedDir[] = [];
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
    input.missingOnly === true ? entries.filter(isMissingAgentTrustedDir) : entries;
  return filtered.toSorted((a, b) => {
    const agentOrder = a.agent.localeCompare(b.agent);
    return agentOrder === 0 ? a.dirPath.localeCompare(b.dirPath) : agentOrder;
  });
}

/** List directory trust entries recorded for Cursor, Claude, and Codex. */
export function listAgentTrustedDirs(input: ListAgentTrustedDirsInput = {}): AgentTrustedDir[] {
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
