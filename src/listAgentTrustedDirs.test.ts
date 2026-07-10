import { chmodSync, mkdirSync, mkdtempSync, writeFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { codexProjectTableHeader } from "./agents/codex.ts";
import { cursorProjectSlug } from "./agents/cursor.ts";
import { isMissingAgentTrustedDir, listAgentTrustedDirs } from "./listAgentTrustedDirs.ts";

describe(listAgentTrustedDirs, () => {
  let fakeHome: string;
  beforeEach(() => {
    fakeHome = mkdtempSync(path.join(os.tmpdir(), "agent-trust-list-"));
  });
  afterEach(() => {
    rmSync(fakeHome, { recursive: true, force: true });
  });

  it("lists Cursor, Claude, and Codex trust entries", () => {
    const workspacePath = path.join(fakeHome, "worktrees", "repo-team-1");
    const markerPath = path.join(
      fakeHome,
      ".cursor",
      "projects",
      cursorProjectSlug(workspacePath),
      ".workspace-trusted",
    );
    mkdirSync(path.dirname(markerPath), { recursive: true });
    writeFileSync(
      markerPath,
      `${JSON.stringify({ workspacePath, trustMethod: "agent-trust" })}\n`,
      "utf8",
    );
    writeFileSync(
      path.join(fakeHome, ".claude.json"),
      JSON.stringify({
        projects: {
          [path.resolve(fakeHome, "worktrees")]: { hasTrustDialogAccepted: true },
        },
      }),
      "utf8",
    );
    mkdirSync(path.join(fakeHome, ".codex"), { recursive: true });
    writeFileSync(
      path.join(fakeHome, ".codex", "config.toml"),
      `${codexProjectTableHeader(workspacePath)}\ntrust_level = "trusted"\n`,
      "utf8",
    );

    const entries = listAgentTrustedDirs({ homeDir: fakeHome });
    expect(entries).toHaveLength(3);
    expect(entries.map((entry) => entry.agent).toSorted()).toEqual(["claude", "codex", "cursor"]);
  });

  it("filters by agent", () => {
    writeFileSync(path.join(fakeHome, ".claude.json"), "[]", "utf8");
    expect(listAgentTrustedDirs({ homeDir: fakeHome, agent: "claude" })).toEqual([]);
  });

  it("lists only missing workspace paths when requested", () => {
    const existingPath = path.resolve(fakeHome, "still-here");
    const missingPath = path.resolve(fakeHome, "gone");
    mkdirSync(existingPath, { recursive: true });
    writeFileSync(
      path.join(fakeHome, ".claude.json"),
      JSON.stringify({
        projects: {
          [existingPath]: { hasTrustDialogAccepted: true },
          [missingPath]: { hasTrustDialogAccepted: true },
        },
      }),
      "utf8",
    );

    expect(listAgentTrustedDirs({ homeDir: fakeHome, missingOnly: true })).toEqual([
      expect.objectContaining({ agent: "claude", dirPath: missingPath }),
    ]);
  });

  it("returns [] when home cannot be resolved", () => {
    expect(
      listAgentTrustedDirs({
        readHome: () => {
          throw new Error("no home");
        },
      }),
    ).toEqual([]);
  });
});

describe(isMissingAgentTrustedDir, () => {
  it("returns true for a path that does not exist", () => {
    expect(
      isMissingAgentTrustedDir({
        agent: "claude",
        dirPath: "/tmp/agent-trust-definitely-missing-xyz",
        detail: "hasTrustDialogAccepted",
        store: "/tmp/.claude.json#projects",
      }),
    ).toBe(true);
  });

  it("returns false for a path that exists", () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "agent-trust-exists-"));
    expect(
      isMissingAgentTrustedDir({
        agent: "claude",
        dirPath: dir,
        detail: "hasTrustDialogAccepted",
        store: "/tmp/.claude.json#projects",
      }),
    ).toBe(false);
    chmodSync(dir, 0o700);
    rmSync(dir, { recursive: true, force: true });
  });
});
