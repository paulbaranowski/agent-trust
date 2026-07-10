import { homedir } from "node:os";
import path from "node:path";

import { deleteClaudeTrustEntry } from "./agents/claude.ts";
import { deleteCodexTrustEntry } from "./agents/codex.ts";
import { deleteCursorTrustEntry } from "./agents/cursor.ts";
import { resolveHomeDir } from "./agents/shared.ts";
import { collectTrustEntries } from "./list.ts";
import type { AgentTrustAgent, AgentTrustEntry, MutationEntryResult, UntrustResult } from "./types.ts";

export interface UntrustInput {
  homeDir?: string;
  agent?: AgentTrustAgent;
  /** Delete trust for this exact absolute workspace path. */
  path?: string;
  /** Delete trust for every path under this directory prefix. */
  pathPrefix?: string;
  /** Delete every listed trust entry (subject to `agent` / `trustMethod`). */
  all?: boolean;
  /** Cursor only: restrict deletion to markers whose `trustMethod` matches. */
  trustMethod?: string;
  /** Test seam for `os.homedir()` failures. */
  readHome?: () => string;
}

function normalizedPrefix(prefix: string): string {
  const resolved = path.resolve(prefix);
  return resolved.endsWith(path.sep) ? resolved : `${resolved}${path.sep}`;
}

function matchesDeleteTarget(entry: AgentTrustEntry, input: UntrustInput): boolean {
  if (input.agent !== undefined && entry.agent !== input.agent) {
    return false;
  }
  if (
    input.trustMethod !== undefined &&
    (entry.agent !== "cursor" || entry.detail !== input.trustMethod)
  ) {
    return false;
  }
  if (input.all === true) {
    return true;
  }
  if (input.path !== undefined) {
    return path.resolve(entry.workspacePath) === path.resolve(input.path);
  }
  if (input.pathPrefix !== undefined) {
    const prefix = normalizedPrefix(input.pathPrefix);
    const resolved = `${path.resolve(entry.workspacePath)}${path.sep}`;
    return resolved.startsWith(prefix);
  }
  return false;
}

function deleteTrustEntry(homeDir: string, entry: AgentTrustEntry): boolean {
  switch (entry.agent) {
    case "cursor":
      return deleteCursorTrustEntry(entry.store);
    case "claude":
      return deleteClaudeTrustEntry(homeDir, entry.workspacePath);
    case "codex":
      return deleteCodexTrustEntry(homeDir, entry.workspacePath);
    default: {
      const unsupportedAgent: never = entry.agent;
      throw new Error(`Unsupported trust agent: ${String(unsupportedAgent)}`);
    }
  }
}

/** Delete a single trust entry, capturing any I/O failure as a Result instead of throwing. */
export function deleteTrustEntrySafe(homeDir: string, entry: AgentTrustEntry): MutationEntryResult {
  try {
    return {
      agent: entry.agent,
      workspacePath: entry.workspacePath,
      deleted: deleteTrustEntry(homeDir, entry),
    };
  } catch (error) {
    return {
      agent: entry.agent,
      workspacePath: entry.workspacePath,
      deleted: false,
      error: `agent-trust: could not remove ${entry.agent} workspace trust for ${entry.workspacePath} (${String(error)})`,
    };
  }
}

/** Delete workspace trust entries from Cursor, Claude, and/or Codex stores. */
export function untrust(input: UntrustInput): UntrustResult {
  const hasTarget =
    input.all === true || input.path !== undefined || input.pathPrefix !== undefined;
  if (!hasTarget) {
    throw new Error("untrust requires all, path, or pathPrefix");
  }

  const home = resolveHomeDir(input.homeDir, input.readHome ?? homedir);
  if (home === undefined) {
    return { results: [] };
  }

  const targets = collectTrustEntries({ homeDir: home }).filter((entry) =>
    matchesDeleteTarget(entry, input),
  );

  return { results: targets.map((entry) => deleteTrustEntrySafe(home, entry)) };
}

/** @internal Exported for branch-coverage tests. */
export function matchesDeleteTargetForTests(entry: AgentTrustEntry, input: UntrustInput): boolean {
  return matchesDeleteTarget(entry, input);
}

/** @internal Exported for branch-coverage tests. */
export function normalizedPrefixForTests(prefix: string): string {
  return normalizedPrefix(prefix);
}

/** @internal Exported for branch-coverage tests. */
export function deleteTrustEntryForTests(homeDir: string, entry: AgentTrustEntry): boolean {
  return deleteTrustEntry(homeDir, entry);
}
