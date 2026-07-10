import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { cursorProjectSlug } from "./agents/cursor.ts";
import { resolveWorkspacePath, trust } from "./trust.ts";

describe(trust, () => {
  let fakeHome: string;
  beforeEach(() => {
    fakeHome = mkdtempSync(path.join(os.tmpdir(), "agent-trust-api-"));
  });
  afterEach(() => {
    rmSync(fakeHome, { recursive: true, force: true });
  });

  it("defaults trustMethod to agent-trust", () => {
    const workspacePath = path.join(fakeHome, "ws");
    const result = trust({ agent: "cursor", workspacePath, homeDir: fakeHome });
    expect(result).toMatchObject({ ok: true, status: "trusted", agent: "cursor" });
    const marker = JSON.parse(
      readFileSync(
        path.join(
          fakeHome,
          ".cursor",
          "projects",
          cursorProjectSlug(workspacePath),
          ".workspace-trusted",
        ),
        "utf8",
      ),
    ) as { trustMethod: string };
    expect(marker.trustMethod).toBe("agent-trust");
  });

  it("records a custom trustMethod in the Cursor marker", () => {
    const workspacePath = path.join(fakeHome, "ws-gc");
    trust({
      agent: "cursor",
      workspacePath,
      homeDir: fakeHome,
      trustMethod: "groundcrew-auto-trust",
    });
    const marker = JSON.parse(
      readFileSync(
        path.join(
          fakeHome,
          ".cursor",
          "projects",
          cursorProjectSlug(workspacePath),
          ".workspace-trusted",
        ),
        "utf8",
      ),
    ) as { trustMethod: string };
    expect(marker.trustMethod).toBe("groundcrew-auto-trust");
  });

  it("accepts cursor-agent and normalizes to cursor", () => {
    const result = trust({
      agent: "cursor-agent",
      workspacePath: path.join(fakeHome, "ws2"),
      homeDir: fakeHome,
      trustMethod: "groundcrew-auto-trust",
    });
    expect(result).toMatchObject({ ok: true, agent: "cursor" });
  });

  it("trusts Claude workspaces", () => {
    const workspacePath = path.join(fakeHome, "claude-ws");
    const result = trust({ agent: "claude", workspacePath, homeDir: fakeHome });
    expect(result).toMatchObject({ ok: true, status: "trusted", agent: "claude" });
    expect(existsSync(path.join(fakeHome, ".claude.json"))).toBe(true);
  });

  it("trusts Codex workspaces", () => {
    const workspacePath = path.join(fakeHome, "codex-ws");
    const result = trust({ agent: "codex", workspacePath, homeDir: fakeHome });
    expect(result).toMatchObject({ ok: true, status: "trusted", agent: "codex" });
    expect(existsSync(path.join(fakeHome, ".codex", "config.toml"))).toBe(true);
  });

  it("skips unknown agents without writing", () => {
    expect(trust({ agent: "gemini", workspacePath: "/tmp/x", homeDir: fakeHome })).toEqual({
      ok: true,
      status: "skipped",
      reason: "unknown-agent",
      agentCommandName: "gemini",
    });
    expect(existsSync(path.join(fakeHome, ".claude.json"))).toBe(false);
    expect(existsSync(path.join(fakeHome, ".cursor"))).toBe(false);
  });

  it("returns error when home cannot be resolved", () => {
    expect(
      trust({
        agent: "claude",
        workspacePath: "/tmp/x",
        readHome: () => {
          throw new Error("no home");
        },
      }),
    ).toMatchObject({ ok: false, status: "error" });
  });
});

describe(resolveWorkspacePath, () => {
  it("defaults a blank workspace path to cwd", () => {
    expect(resolveWorkspacePath({ workspacePath: "", cwd: "/tmp/test-ws" })).toBe("/tmp/test-ws");
  });

  it("uses an explicit workspace path when provided", () => {
    expect(resolveWorkspacePath({ workspacePath: "/tmp/child", cwd: "/tmp/ignored" })).toBe(
      "/tmp/child",
    );
  });

  it("defaults cwd to process.cwd when omitted", () => {
    expect(resolveWorkspacePath({})).toBe(process.cwd());
  });
});
