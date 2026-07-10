import type { AgentTrustAgent } from "./types.ts";

export function isAgentTrustAgent(value: string): value is AgentTrustAgent {
  return value === "cursor" || value === "claude" || value === "codex";
}

export function normalizeAgent(
  agentCommandName: string,
): { ok: true; agent: AgentTrustAgent } | { ok: false; agentCommandName: string } {
  if (agentCommandName === "cursor-agent") {
    return { ok: true, agent: "cursor" };
  }
  if (isAgentTrustAgent(agentCommandName)) {
    return { ok: true, agent: agentCommandName };
  }
  return { ok: false, agentCommandName };
}
