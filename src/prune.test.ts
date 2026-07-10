import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { codexProjectTableHeader } from "./agents/codex.ts";
import { list } from "./list.ts";
import { prune } from "./prune.ts";

describe(prune, () => {
  let fakeHome: string;
  beforeEach(() => {
    fakeHome = mkdtempSync(path.join(os.tmpdir(), "agent-trust-prune-"));
  });
  afterEach(() => {
    rmSync(fakeHome, { recursive: true, force: true });
  });

  it("removes trust entries whose workspace paths no longer exist", () => {
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
    mkdirSync(path.join(fakeHome, ".codex"), { recursive: true });
    writeFileSync(
      path.join(fakeHome, ".codex", "config.toml"),
      `${codexProjectTableHeader(missingPath)}\ntrust_level = "trusted"\n`,
      "utf8",
    );

    const { results } = prune({ homeDir: fakeHome });
    expect(results).toEqual(
      expect.arrayContaining([
        { agent: "claude", workspacePath: missingPath, deleted: true },
        { agent: "codex", workspacePath: missingPath, deleted: true },
      ]),
    );
    expect(list({ homeDir: fakeHome, agent: "claude" })).toHaveLength(1);
    expect(list({ homeDir: fakeHome, agent: "codex" })).toEqual([]);
  });

  it("prunes only the requested agent", () => {
    const existingPath = path.resolve(fakeHome, "still-here");
    const missingClaudePath = path.resolve(fakeHome, "gone-claude");
    const missingCodexPath = path.resolve(fakeHome, "gone-codex");
    mkdirSync(existingPath, { recursive: true });
    writeFileSync(
      path.join(fakeHome, ".claude.json"),
      JSON.stringify({
        projects: {
          [existingPath]: { hasTrustDialogAccepted: true },
          [missingClaudePath]: { hasTrustDialogAccepted: true },
        },
      }),
      "utf8",
    );
    mkdirSync(path.join(fakeHome, ".codex"), { recursive: true });
    writeFileSync(
      path.join(fakeHome, ".codex", "config.toml"),
      `${codexProjectTableHeader(missingCodexPath)}\ntrust_level = "trusted"\n`,
      "utf8",
    );

    const { results } = prune({ homeDir: fakeHome, agent: "claude" });
    expect(results).toEqual([
      { agent: "claude", workspacePath: missingClaudePath, deleted: true },
    ]);
    expect(list({ homeDir: fakeHome, agent: "codex" })).toHaveLength(1);
  });

  it("returns [] results when home cannot be resolved", () => {
    expect(
      prune({
        readHome: () => {
          throw new Error("no home");
        },
      }),
    ).toEqual({ results: [] });
  });
});
