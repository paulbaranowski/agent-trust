export type AgentTrustAgent = "cursor" | "claude" | "codex";

export interface AgentTrustEntry {
  agent: AgentTrustAgent;
  workspacePath: string;
  detail: string;
  store: string;
}

export type TrustResult =
  | {
      ok: true;
      status: "trusted";
      agent: AgentTrustAgent;
      workspacePath: string;
    }
  | {
      ok: true;
      status: "already-trusted";
      agent: AgentTrustAgent;
      workspacePath: string;
    }
  | {
      ok: true;
      status: "skipped";
      reason: "unknown-agent";
      agentCommandName: string;
    }
  | {
      ok: false;
      status: "error";
      error: string;
      agent?: AgentTrustAgent;
      workspacePath?: string;
    };

export interface MutationEntryResult {
  agent: AgentTrustAgent;
  workspacePath: string;
  deleted: boolean;
  error?: string;
}

export interface UntrustResult {
  results: MutationEntryResult[];
}

export interface PruneResult {
  results: MutationEntryResult[];
}

export const DEFAULT_TRUST_METHOD = "agent-trust";
