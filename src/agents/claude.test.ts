import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { deleteClaudeTrustEntry, ensureClaudeTrust, listClaudeTrustEntries } from "./claude.ts";

describe(ensureClaudeTrust, () => {
  let fakeHome: string;
  beforeEach(() => {
    fakeHome = mkdtempSync(path.join(os.tmpdir(), "agent-trust-claude-"));
  });
  afterEach(() => {
    rmSync(fakeHome, { recursive: true, force: true });
  });

  function readClaudeJson(): Record<string, unknown> {
    return JSON.parse(readFileSync(path.join(fakeHome, ".claude.json"), "utf8")) as Record<
      string,
      unknown
    >;
  }

  it("accepts trust for a new path", () => {
    const workspacePath = path.join(fakeHome, "claude-ws");
    const result = ensureClaudeTrust({
      workspacePath,
      homeDir: fakeHome,
      trustMethod: "agent-trust",
    });
    expect(result).toMatchObject({ ok: true, status: "trusted", agent: "claude" });
    const projects = readClaudeJson()["projects"] as Record<string, Record<string, unknown>>;
    const entry = projects[path.resolve(workspacePath)];
    expect(entry?.["hasTrustDialogAccepted"]).toBe(true);
    expect(entry?.["hasCompletedProjectOnboarding"]).toBe(true);
  });

  it("is idempotent and preserves other fields when already trusted", () => {
    const workspacePath = path.resolve(fakeHome, "claude-trusted");
    writeFileSync(
      path.join(fakeHome, ".claude.json"),
      JSON.stringify({
        projects: {
          [workspacePath]: { hasTrustDialogAccepted: true, customField: "keep-me" },
        },
      }),
      "utf8",
    );

    const result = ensureClaudeTrust({
      workspacePath,
      homeDir: fakeHome,
      trustMethod: "agent-trust",
    });

    expect(result.status).toBe("already-trusted");
    const projects = readClaudeJson()["projects"] as Record<string, Record<string, unknown>>;
    expect(projects[workspacePath]).toEqual({
      hasTrustDialogAccepted: true,
      customField: "keep-me",
    });
  });

  it("recovers from malformed claude.json", () => {
    const workspacePath = path.join(fakeHome, "claude-recover");
    writeFileSync(path.join(fakeHome, ".claude.json"), "not-json", "utf8");

    const result = ensureClaudeTrust({
      workspacePath,
      homeDir: fakeHome,
      trustMethod: "agent-trust",
    });

    expect(result).toMatchObject({ ok: true, status: "trusted" });
    const projects = readClaudeJson()["projects"] as Record<string, Record<string, unknown>>;
    expect(projects[path.resolve(workspacePath)]?.["hasTrustDialogAccepted"]).toBe(true);
  });

  it("preserves unrelated fields when projects is invalid", () => {
    const workspacePath = path.join(fakeHome, "claude-invalid-projects");
    writeFileSync(
      path.join(fakeHome, ".claude.json"),
      JSON.stringify({ projects: "bad", theme: "dark" }),
      "utf8",
    );

    ensureClaudeTrust({ workspacePath, homeDir: fakeHome, trustMethod: "agent-trust" });

    const parsed = readClaudeJson();
    expect(parsed["theme"]).toBe("dark");
    const projects = parsed["projects"] as Record<string, Record<string, unknown>>;
    expect(projects[path.resolve(workspacePath)]?.["hasTrustDialogAccepted"]).toBe(true);
  });

  it("returns an error result when the file cannot be written", () => {
    if (typeof process.getuid === "function" && process.getuid() === 0) {
      return;
    }
    const workspacePath = path.join(fakeHome, "claude-write-fail");
    chmodSync(fakeHome, 0o500);

    const result = ensureClaudeTrust({
      workspacePath,
      homeDir: fakeHome,
      trustMethod: "agent-trust",
    });

    chmodSync(fakeHome, 0o700);
    expect(result).toMatchObject({ ok: false, status: "error", agent: "claude" });
    if (!result.ok) {
      expect(result.error).toContain("agent-trust:");
    }
  });
});

describe(listClaudeTrustEntries, () => {
  let fakeHome: string;
  beforeEach(() => {
    fakeHome = mkdtempSync(path.join(os.tmpdir(), "agent-trust-claude-list-"));
  });
  afterEach(() => {
    rmSync(fakeHome, { recursive: true, force: true });
  });

  it("lists only projects with hasTrustDialogAccepted === true", () => {
    const trustedPath = path.resolve(fakeHome, "trusted");
    const untrustedPath = path.resolve(fakeHome, "untrusted");
    writeFileSync(
      path.join(fakeHome, ".claude.json"),
      JSON.stringify({
        projects: {
          [trustedPath]: { hasTrustDialogAccepted: true },
          [untrustedPath]: { note: "skip-me" },
        },
      }),
      "utf8",
    );

    expect(listClaudeTrustEntries(fakeHome)).toEqual([
      expect.objectContaining({ agent: "claude", dirPath: trustedPath }),
    ]);
  });

  it("treats malformed claude.json as empty", () => {
    writeFileSync(path.join(fakeHome, ".claude.json"), "{not-json", "utf8");
    expect(listClaudeTrustEntries(fakeHome)).toEqual([]);
  });
});

describe(deleteClaudeTrustEntry, () => {
  let fakeHome: string;
  beforeEach(() => {
    fakeHome = mkdtempSync(path.join(os.tmpdir(), "agent-trust-claude-del-"));
  });
  afterEach(() => {
    rmSync(fakeHome, { recursive: true, force: true });
  });

  it("returns false when the project never accepted trust", () => {
    const workspacePath = path.resolve(fakeHome, "no-trust");
    writeFileSync(
      path.join(fakeHome, ".claude.json"),
      JSON.stringify({ projects: { [workspacePath]: { note: "skip-me" } } }),
      "utf8",
    );
    expect(deleteClaudeTrustEntry(fakeHome, workspacePath)).toBe(false);
  });

  it("returns false when there is no projects map", () => {
    writeFileSync(path.join(fakeHome, ".claude.json"), "{}\n", "utf8");
    expect(deleteClaudeTrustEntry(fakeHome, path.resolve(fakeHome, "missing"))).toBe(false);
  });

  it("preserves unrelated fields when clearing trust", () => {
    const workspacePath = path.resolve(fakeHome, "keep-fields");
    writeFileSync(
      path.join(fakeHome, ".claude.json"),
      JSON.stringify({
        projects: { [workspacePath]: { hasTrustDialogAccepted: true, note: "keep-me" } },
      }),
      "utf8",
    );

    expect(deleteClaudeTrustEntry(fakeHome, workspacePath)).toBe(true);
    const projects = (
      JSON.parse(readFileSync(path.join(fakeHome, ".claude.json"), "utf8")) as {
        projects: Record<string, Record<string, unknown>>;
      }
    ).projects;
    expect(projects[workspacePath]).toEqual({ note: "keep-me" });
  });

  it("removes the project key when trust flags were the only fields", () => {
    const workspacePath = path.resolve(fakeHome, "only-trust");
    writeFileSync(
      path.join(fakeHome, ".claude.json"),
      JSON.stringify({
        projects: {
          [workspacePath]: { hasTrustDialogAccepted: true, hasCompletedProjectOnboarding: true },
        },
      }),
      "utf8",
    );

    expect(deleteClaudeTrustEntry(fakeHome, workspacePath)).toBe(true);
    const claudeJson = JSON.parse(readFileSync(path.join(fakeHome, ".claude.json"), "utf8")) as {
      projects?: Record<string, unknown>;
    };
    expect(claudeJson.projects).toEqual({});
  });

  it("deletes entries keyed by a non-canonical path string", () => {
    const canonical = path.resolve(fakeHome, "non-canonical");
    const storedKey = `${canonical}${path.sep}`;
    writeFileSync(
      path.join(fakeHome, ".claude.json"),
      JSON.stringify({
        projects: {
          [storedKey]: { hasTrustDialogAccepted: true, hasCompletedProjectOnboarding: true },
        },
      }),
      "utf8",
    );

    expect(deleteClaudeTrustEntry(fakeHome, canonical)).toBe(true);
    const claudeJson = JSON.parse(readFileSync(path.join(fakeHome, ".claude.json"), "utf8")) as {
      projects?: Record<string, unknown>;
    };
    expect(claudeJson.projects).toEqual({});
  });
});
