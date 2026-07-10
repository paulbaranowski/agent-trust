import { homedir } from "node:os";
import path from "node:path";

import { ensureClaudeTrust } from "./agents/claude.ts";
import { ensureCodexTrust } from "./agents/codex.ts";
import { ensureCursorTrust } from "./agents/cursor.ts";
import { resolveHomeDir } from "./agents/shared.ts";
import { normalizeAgent } from "./normalize.ts";
import { DEFAULT_TRUST_METHOD, type AgentTrustDirResult } from "./types.ts";

export interface AgentTrustDirInput {
  agent: string;
  dirPath: string;
  homeDir?: string;
  trustMethod?: string;
  /** Override Codex config directory (`CODEX_HOME` / `~/.codex`). */
  codexHome?: string;
  /** Test seam for `os.homedir()` failures. */
  readHome?: () => string;
}

/**
 * Resolve a directory path for the CLI `--dir` flag: blank values fall back to
 * `cwd` (usually the directory you run from).
 */
export function resolveDirPath(input: { dirPath?: string; cwd?: string }): string {
  const cwd = input.cwd ?? process.cwd();
  if (input.dirPath === undefined || input.dirPath.trim() === "") {
    return path.resolve(cwd);
  }
  return path.resolve(input.dirPath);
}

/** Record directory trust for an agent. Never throws on store I/O — returns an `AgentTrustDirResult`. */
export function agentTrustDir(input: AgentTrustDirInput): AgentTrustDirResult {
  const normalized = normalizeAgent(input.agent);
  if (!normalized.ok) {
    return {
      ok: true,
      status: "skipped",
      reason: "unknown-agent",
      agentCommandName: normalized.agentCommandName,
    };
  }

  const home = resolveHomeDir(input.homeDir, input.readHome ?? homedir);
  if (home === undefined) {
    return {
      ok: false,
      status: "error",
      error: "agent-trust: could not resolve home directory",
      agent: normalized.agent,
      dirPath: input.dirPath,
    };
  }

  const trustMethod = input.trustMethod ?? DEFAULT_TRUST_METHOD;
  const args = {
    workspacePath: input.dirPath,
    homeDir: home,
    trustMethod,
  };

  switch (normalized.agent) {
    case "cursor":
      return ensureCursorTrust(args);
    case "claude":
      return ensureClaudeTrust(args);
    case "codex":
      return ensureCodexTrust({
        ...args,
        ...(input.codexHome === undefined ? {} : { codexHome: input.codexHome }),
      });
  }
}
