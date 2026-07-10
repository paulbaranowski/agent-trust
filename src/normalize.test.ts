import { describe, expect, it } from "vitest";

import { isAgentTrustAgent, normalizeAgent } from "./normalize.ts";

describe(normalizeAgent, () => {
  it("maps cursor-agent to cursor", () => {
    expect(normalizeAgent("cursor-agent")).toEqual({
      ok: true,
      agent: "cursor",
    });
  });

  it("accepts canonical agents", () => {
    expect(normalizeAgent("cursor")).toEqual({ ok: true, agent: "cursor" });
    expect(normalizeAgent("claude")).toEqual({ ok: true, agent: "claude" });
    expect(normalizeAgent("codex")).toEqual({ ok: true, agent: "codex" });
  });

  it("rejects unknown agents", () => {
    expect(normalizeAgent("gemini")).toEqual({
      ok: false,
      agentCommandName: "gemini",
    });
  });
});

describe(isAgentTrustAgent, () => {
  it("returns true only for canonical agents", () => {
    expect(isAgentTrustAgent("cursor")).toBe(true);
    expect(isAgentTrustAgent("claude")).toBe(true);
    expect(isAgentTrustAgent("codex")).toBe(true);
    expect(isAgentTrustAgent("cursor-agent")).toBe(false);
    expect(isAgentTrustAgent("gemini")).toBe(false);
  });
});
