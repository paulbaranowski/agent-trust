export type AgentTrustAgent = "cursor" | "claude" | "codex";

export interface AgentTrustedDir {
  agent: AgentTrustAgent;
  dirPath: string;
  detail: string;
  store: string;
}

export type AgentTrustDirResult =
  | {
      ok: true;
      status: "trusted";
      agent: AgentTrustAgent;
      dirPath: string;
    }
  | {
      ok: true;
      status: "already-trusted";
      agent: AgentTrustAgent;
      dirPath: string;
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
      dirPath?: string;
    };

export interface AgentTrustMutationResult {
  agent: AgentTrustAgent;
  dirPath: string;
  deleted: boolean;
  error?: string;
}

export interface AgentUntrustDirResult {
  results: AgentTrustMutationResult[];
}

export interface PruneAgentTrustedDirsResult {
  results: AgentTrustMutationResult[];
}

export const DEFAULT_TRUST_METHOD = "agent-trust";
