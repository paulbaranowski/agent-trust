import { homedir } from "node:os";
import path from "node:path";

import { ensureClaudeTrust } from "./agents/claude.ts";
import { ensureCodexTrust } from "./agents/codex.ts";
import { ensureCursorTrust } from "./agents/cursor.ts";
import { resolveHomeDir } from "./agents/shared.ts";
import { normalizeAgent } from "./normalize.ts";
import { DEFAULT_TRUST_METHOD, type TrustResult } from "./types.ts";

export interface TrustInput {
  agent: string;
  workspacePath: string;
  homeDir?: string;
  trustMethod?: string;
  /** Test seam for `os.homedir()` failures. */
  readHome?: () => string;
}

/**
 * Resolve a workspace path for the CLI `--dir` flag: blank values fall back to
 * `cwd` (usually the directory you run from).
 */
export function resolveWorkspacePath(input: { workspacePath?: string; cwd?: string }): string {
  const cwd = input.cwd ?? process.cwd();
  if (input.workspacePath === undefined || input.workspacePath.trim() === "") {
    return path.resolve(cwd);
  }
  return path.resolve(input.workspacePath);
}

/** Record workspace trust for an agent. Never throws on store I/O — returns a `TrustResult`. */
export function trust(input: TrustInput): TrustResult {
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
      workspacePath: input.workspacePath,
    };
  }

  const trustMethod = input.trustMethod ?? DEFAULT_TRUST_METHOD;
  const args = {
    workspacePath: input.workspacePath,
    homeDir: home,
    trustMethod,
  };

  switch (normalized.agent) {
    case "cursor":
      return ensureCursorTrust(args);
    case "claude":
      return ensureClaudeTrust(args);
    case "codex":
      return ensureCodexTrust(args);
  }
}
