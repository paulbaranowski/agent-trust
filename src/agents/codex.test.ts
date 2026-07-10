import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  codexProjectTableHeader,
  deleteCodexTrustEntry,
  ensureCodexTrust,
  listCodexTrustEntries,
  listCodexTrustedProjects,
  removeCodexProjectTrust,
} from "./codex.ts";

describe(codexProjectTableHeader, () => {
  it("quotes the absolute workspace path", () => {
    expect(codexProjectTableHeader("/Users/dev/repo-team-1")).toBe(
      '[projects."/Users/dev/repo-team-1"]',
    );
  });

  it("escapes backslashes and double quotes", () => {
    expect(codexProjectTableHeader(String.raw`/tmp\weird"path`)).toBe(
      String.raw`[projects."/tmp\\weird\"path"]`,
    );
  });
});

describe(ensureCodexTrust, () => {
  let fakeHome: string;
  beforeEach(() => {
    fakeHome = mkdtempSync(path.join(os.tmpdir(), "agent-trust-codex-"));
  });
  afterEach(() => {
    rmSync(fakeHome, { recursive: true, force: true });
  });

  function readConfig(): string {
    return readFileSync(path.join(fakeHome, ".codex", "config.toml"), "utf8");
  }
  function configPath(): string {
    return path.join(fakeHome, ".codex", "config.toml");
  }

  it("trusts a new workspace", () => {
    const workspacePath = path.join(fakeHome, "codex-ws");
    const result = ensureCodexTrust({ workspacePath, homeDir: fakeHome, trustMethod: "agent-trust" });
    expect(result).toMatchObject({ ok: true, status: "trusted", agent: "codex" });
    expect(readConfig()).toBe(
      `${codexProjectTableHeader(path.resolve(workspacePath))}\ntrust_level = "trusted"\n`,
    );
  });

  it("is idempotent when already trusted", () => {
    const workspacePath = path.resolve(fakeHome, "codex-trusted");
    const existing = `[features]\nhooks = true\n\n${codexProjectTableHeader(workspacePath)}\ntrust_level = "trusted"\n`;
    mkdirSync(path.join(fakeHome, ".codex"), { recursive: true });
    writeFileSync(configPath(), existing, "utf8");
    const before = statSync(configPath()).mtimeMs;

    const result = ensureCodexTrust({ workspacePath, homeDir: fakeHome, trustMethod: "agent-trust" });
    expect(result.status).toBe("already-trusted");
    expect(readConfig()).toBe(existing);
    expect(statSync(configPath()).mtimeMs).toBe(before);
  });

  it("preserves unrelated config settings", () => {
    const workspacePath = path.join(fakeHome, "codex-new");
    mkdirSync(path.join(fakeHome, ".codex"), { recursive: true });
    writeFileSync(configPath(), "[features]\nhooks = true\n", "utf8");

    ensureCodexTrust({ workspacePath, homeDir: fakeHome, trustMethod: "agent-trust" });
    expect(readConfig()).toBe(
      `[features]\nhooks = true\n${codexProjectTableHeader(path.resolve(workspacePath))}\ntrust_level = "trusted"\n`,
    );
  });

  it("upgrades an existing project section to trusted", () => {
    const workspacePath = path.resolve(fakeHome, "codex-upgrade");
    mkdirSync(path.join(fakeHome, ".codex"), { recursive: true });
    writeFileSync(
      configPath(),
      `${codexProjectTableHeader(workspacePath)}\napproval_policy = "on-request"\n`,
      "utf8",
    );

    ensureCodexTrust({ workspacePath, homeDir: fakeHome, trustMethod: "agent-trust" });
    expect(readConfig()).toBe(
      `${codexProjectTableHeader(workspacePath)}\napproval_policy = "on-request"\ntrust_level = "trusted"\n`,
    );
  });

  it("replaces a non-trusted trust_level", () => {
    const workspacePath = path.resolve(fakeHome, "codex-replace");
    mkdirSync(path.join(fakeHome, ".codex"), { recursive: true });
    writeFileSync(
      configPath(),
      `${codexProjectTableHeader(workspacePath)}\ntrust_level = "untrusted"\n`,
      "utf8",
    );

    ensureCodexTrust({ workspacePath, homeDir: fakeHome, trustMethod: "agent-trust" });
    expect(readConfig()).toBe(
      `${codexProjectTableHeader(workspacePath)}\ntrust_level = "trusted"\n`,
    );
  });

  it("updates trust inside a section when later sections follow", () => {
    const workspacePath = path.resolve(fakeHome, "codex-middle");
    mkdirSync(path.join(fakeHome, ".codex"), { recursive: true });
    writeFileSync(
      configPath(),
      `${codexProjectTableHeader(workspacePath)}\ntrust_level = "untrusted"\n[features]\nhooks = true\n`,
      "utf8",
    );

    ensureCodexTrust({ workspacePath, homeDir: fakeHome, trustMethod: "agent-trust" });
    expect(readConfig()).toBe(
      `${codexProjectTableHeader(workspacePath)}\ntrust_level = "trusted"\n[features]\nhooks = true\n`,
    );
  });

  it("appends a newline before a new section when config omits a trailing newline", () => {
    const workspacePath = path.join(fakeHome, "codex-no-nl");
    mkdirSync(path.join(fakeHome, ".codex"), { recursive: true });
    writeFileSync(configPath(), "[features]\nhooks = true", "utf8");

    ensureCodexTrust({ workspacePath, homeDir: fakeHome, trustMethod: "agent-trust" });
    expect(readConfig()).toBe(
      `[features]\nhooks = true\n${codexProjectTableHeader(path.resolve(workspacePath))}\ntrust_level = "trusted"\n`,
    );
  });

  it("adds trust_level to a section that omits a trailing newline", () => {
    const workspacePath = path.resolve(fakeHome, "codex-section-no-nl");
    mkdirSync(path.join(fakeHome, ".codex"), { recursive: true });
    writeFileSync(
      configPath(),
      `${codexProjectTableHeader(workspacePath)}\napproval_policy = "on-request"`,
      "utf8",
    );

    ensureCodexTrust({ workspacePath, homeDir: fakeHome, trustMethod: "agent-trust" });
    expect(readConfig()).toBe(
      `${codexProjectTableHeader(workspacePath)}\napproval_policy = "on-request"\ntrust_level = "trusted"\n`,
    );
  });

  it("seeds from fresh when an existing config cannot be read", () => {
    const workspacePath = path.join(fakeHome, "codex-unreadable");
    mkdirSync(path.join(fakeHome, ".codex"), { recursive: true });
    writeFileSync(configPath(), "[features]\nhooks = true\n", "utf8");
    chmodSync(configPath(), 0o000);

    const result = ensureCodexTrust({ workspacePath, homeDir: fakeHome, trustMethod: "agent-trust" });

    chmodSync(configPath(), 0o600);
    expect(result).toMatchObject({ ok: true, status: "trusted" });
    expect(readConfig()).toBe(
      `${codexProjectTableHeader(path.resolve(workspacePath))}\ntrust_level = "trusted"\n`,
    );
  });
});

describe(listCodexTrustedProjects, () => {
  it("parses trusted project sections", () => {
    const workspacePath = "/tmp/repo-team-1";
    const config = `${codexProjectTableHeader(workspacePath)}\ntrust_level = "trusted"\napproval_policy = "on-request"\n`;
    expect(listCodexTrustedProjects(config)).toEqual([
      { path: workspacePath, trustLevel: "trusted" },
    ]);
  });

  it("skips sections without trust_level and parses escaped paths", () => {
    const trustedPath = "/tmp/repo team";
    const afterNextPath = "/tmp/after-next";
    const config = [
      `${codexProjectTableHeader(trustedPath)}\ntrust_level = "trusted"\n`,
      `${codexProjectTableHeader("/tmp/other")}\napproval_policy = "on-request"\n`,
      `${codexProjectTableHeader(afterNextPath)}\ntrust_level = "trusted"\n`,
    ].join("\n");
    expect(listCodexTrustedProjects(config)).toEqual(
      expect.arrayContaining([
        { path: trustedPath, trustLevel: "trusted" },
        { path: afterNextPath, trustLevel: "trusted" },
      ]),
    );
    expect(listCodexTrustedProjects(config)).toHaveLength(2);
  });
});

describe(listCodexTrustEntries, () => {
  it("treats an unreadable config as empty", () => {
    const fakeHome = mkdtempSync(path.join(os.tmpdir(), "agent-trust-codex-list-"));
    const codexConfig = path.join(fakeHome, ".codex", "config.toml");
    mkdirSync(path.dirname(codexConfig), { recursive: true });
    writeFileSync(codexConfig, "[features]\nhooks = true\n", "utf8");
    chmodSync(codexConfig, 0o000);
    expect(listCodexTrustEntries(fakeHome)).toEqual([]);
    chmodSync(codexConfig, 0o600);
    rmSync(fakeHome, { recursive: true, force: true });
  });
});

describe(removeCodexProjectTrust, () => {
  it("removes trust_level and keeps other project keys", () => {
    const workspacePath = "/tmp/repo-team-1";
    const config = `${codexProjectTableHeader(workspacePath)}\napproval_policy = "on-request"\ntrust_level = "trusted"\n`;
    expect(removeCodexProjectTrust(config, workspacePath)).toBe(
      `${codexProjectTableHeader(workspacePath)}\napproval_policy = "on-request"\n`,
    );
  });

  it("removes the whole project section when trust_level was the only key", () => {
    const workspacePath = "/tmp/repo-team-1";
    const config = `[features]\nhooks = true\n\n${codexProjectTableHeader(workspacePath)}\ntrust_level = "trusted"\n`;
    expect(removeCodexProjectTrust(config, workspacePath)).toBe("[features]\nhooks = true\n");
  });

  it("stops at the next TOML section when reading project bodies", () => {
    const workspacePath = "/tmp/repo-team-1";
    const config = [
      codexProjectTableHeader(workspacePath),
      'trust_level = "trusted"',
      "[features]",
      "hooks = true",
      "",
    ].join("\n");
    expect(removeCodexProjectTrust(config, workspacePath)).toBe("[features]\nhooks = true\n");
  });

  it("is a no-op when the project section is missing", () => {
    const config = "[features]\nhooks = true\n";
    expect(removeCodexProjectTrust(config, "/tmp/missing")).toBe(config);
  });
});

describe(deleteCodexTrustEntry, () => {
  it("returns false when the project trust section is already absent", () => {
    const fakeHome = mkdtempSync(path.join(os.tmpdir(), "agent-trust-codex-del-"));
    mkdirSync(path.join(fakeHome, ".codex"), { recursive: true });
    writeFileSync(path.join(fakeHome, ".codex", "config.toml"), "[features]\nhooks = true\n", "utf8");
    expect(deleteCodexTrustEntry(fakeHome, "/tmp/missing")).toBe(false);
    rmSync(fakeHome, { recursive: true, force: true });
  });

  it("removes trust and returns true", () => {
    const fakeHome = mkdtempSync(path.join(os.tmpdir(), "agent-trust-codex-del2-"));
    const workspacePath = path.resolve(fakeHome, "codex-del");
    mkdirSync(path.join(fakeHome, ".codex"), { recursive: true });
    writeFileSync(
      path.join(fakeHome, ".codex", "config.toml"),
      `${codexProjectTableHeader(workspacePath)}\ntrust_level = "trusted"\n`,
      "utf8",
    );
    expect(deleteCodexTrustEntry(fakeHome, workspacePath)).toBe(true);
    expect(listCodexTrustEntries(fakeHome)).toEqual([]);
    rmSync(fakeHome, { recursive: true, force: true });
  });
});
