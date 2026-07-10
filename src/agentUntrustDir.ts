import { homedir } from "node:os";
import path from "node:path";

import { deleteClaudeTrustEntry } from "./agents/claude.ts";
import { deleteCodexTrustEntry } from "./agents/codex.ts";
import { deleteCursorTrustEntry } from "./agents/cursor.ts";
import { resolveHomeDir } from "./agents/shared.ts";
import { collectTrustEntries } from "./listAgentTrustedDirs.ts";
import type {
  AgentTrustAgent,
  AgentTrustedDir,
  AgentTrustMutationResult,
  AgentUntrustDirResult,
} from "./types.ts";

export interface AgentUntrustDirInput {
  homeDir?: string;
  agent?: AgentTrustAgent;
  /** Delete trust for this exact absolute directory path. */
  path?: string;
  /** Delete trust for every path under this directory prefix. */
  pathPrefix?: string;
  /** Delete every listed trust entry (subject to `agent` / `trustMethod`). */
  all?: boolean;
  /** Cursor only: restrict deletion to markers whose `trustMethod` matches. */
  trustMethod?: string;
  /** Override Codex config directory (`CODEX_HOME` / `~/.codex`). */
  codexHome?: string;
  /** Test seam for `os.homedir()` failures. */
  readHome?: () => string;
}

function normalizedPrefix(prefix: string): string {
  const resolved = path.resolve(prefix);
  return resolved.endsWith(path.sep) ? resolved : `${resolved}${path.sep}`;
}

function matchesDeleteTarget(entry: AgentTrustedDir, input: AgentUntrustDirInput): boolean {
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
    return path.resolve(entry.dirPath) === path.resolve(input.path);
  }
  if (input.pathPrefix !== undefined) {
    const prefix = normalizedPrefix(input.pathPrefix);
    const resolved = `${path.resolve(entry.dirPath)}${path.sep}`;
    return resolved.startsWith(prefix);
  }
  return false;
}

function deleteTrustEntry(
  homeDir: string,
  entry: AgentTrustedDir,
  options: { codexHome?: string } = {},
): boolean {
  switch (entry.agent) {
    case "cursor":
      return deleteCursorTrustEntry(entry.store);
    case "claude":
      return deleteClaudeTrustEntry(homeDir, entry.dirPath);
    case "codex":
      return deleteCodexTrustEntry(
        homeDir,
        entry.dirPath,
        options.codexHome === undefined ? {} : { codexHome: options.codexHome },
      );
    default: {
      const unsupportedAgent: never = entry.agent;
      throw new Error(`Unsupported trust agent: ${String(unsupportedAgent)}`);
    }
  }
}

/** Delete a single trust entry, capturing any I/O failure as a Result instead of throwing. */
export function deleteTrustEntrySafe(
  homeDir: string,
  entry: AgentTrustedDir,
  options: { codexHome?: string } = {},
): AgentTrustMutationResult {
  try {
    return {
      agent: entry.agent,
      dirPath: entry.dirPath,
      deleted: deleteTrustEntry(homeDir, entry, options),
    };
  } catch (error) {
    return {
      agent: entry.agent,
      dirPath: entry.dirPath,
      deleted: false,
      error: `agent-trust: could not remove ${entry.agent} workspace trust for ${entry.dirPath} (${String(error)})`,
    };
  }
}

/** Delete directory trust entries from Cursor, Claude, and/or Codex stores. */
export function agentUntrustDir(input: AgentUntrustDirInput): AgentUntrustDirResult {
  const hasTarget =
    input.all === true || input.path !== undefined || input.pathPrefix !== undefined;
  if (!hasTarget) {
    throw new Error("untrust requires all, path, or pathPrefix");
  }

  const home = resolveHomeDir(input.homeDir, input.readHome ?? homedir);
  if (home === undefined) {
    return { results: [] };
  }

  const codexOptions =
    input.codexHome === undefined ? {} : { codexHome: input.codexHome };

  const targets = collectTrustEntries({
    homeDir: home,
    ...(input.agent === undefined ? {} : { agent: input.agent }),
    ...codexOptions,
  }).filter((entry) => matchesDeleteTarget(entry, input));

  return {
    results: targets.map((entry) => deleteTrustEntrySafe(home, entry, codexOptions)),
  };
}

/** @internal Exported for branch-coverage tests. */
export function matchesDeleteTargetForTests(
  entry: AgentTrustedDir,
  input: AgentUntrustDirInput,
): boolean {
  return matchesDeleteTarget(entry, input);
}

/** @internal Exported for branch-coverage tests. */
export function normalizedPrefixForTests(prefix: string): string {
  return normalizedPrefix(prefix);
}

/** @internal Exported for branch-coverage tests. */
export function deleteTrustEntryForTests(homeDir: string, entry: AgentTrustedDir): boolean {
  return deleteTrustEntry(homeDir, entry);
}
