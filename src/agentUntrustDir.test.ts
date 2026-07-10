import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { codexProjectTableHeader } from "./agents/codex.ts";
import { cursorProjectSlug } from "./agents/cursor.ts";
import {
  agentUntrustDir,
  deleteTrustEntryForTests,
  matchesDeleteTargetForTests,
  normalizedPrefixForTests,
} from "./agentUntrustDir.ts";
import { listAgentTrustedDirs } from "./listAgentTrustedDirs.ts";
import type { AgentTrustAgent, AgentTrustedDir } from "./types.ts";

const TRUST_METHOD = "groundcrew-auto-trust";

describe(matchesDeleteTargetForTests, () => {
  const entry: AgentTrustedDir = {
    agent: "cursor",
    dirPath: "/tmp/ws",
    detail: TRUST_METHOD,
    store: "/tmp/.cursor/projects/slug/.workspace-trusted",
  };

  it("filters by agent, trustMethod, path, and prefix", () => {
    expect(matchesDeleteTargetForTests(entry, { all: true })).toBe(true);
    expect(matchesDeleteTargetForTests(entry, { agent: "claude", all: true })).toBe(false);
    expect(
      matchesDeleteTargetForTests({ ...entry, detail: "manual" }, { trustMethod: TRUST_METHOD, all: true }),
    ).toBe(false);
    expect(matchesDeleteTargetForTests(entry, { trustMethod: TRUST_METHOD, all: true })).toBe(true);
    expect(matchesDeleteTargetForTests(entry, { path: "/tmp/ws" })).toBe(true);
    expect(matchesDeleteTargetForTests(entry, { path: "/tmp/other" })).toBe(false);
    expect(matchesDeleteTargetForTests(entry, { pathPrefix: "/tmp" })).toBe(true);
    expect(matchesDeleteTargetForTests(entry, { pathPrefix: "/elsewhere" })).toBe(false);
    expect(matchesDeleteTargetForTests(entry, {})).toBe(false);
  });
});

describe(normalizedPrefixForTests, () => {
  it("keeps root prefixes and appends separators elsewhere", () => {
    expect(normalizedPrefixForTests("/")).toBe("/");
    expect(normalizedPrefixForTests("/tmp/prefix")).toBe(`/tmp/prefix${path.sep}`);
  });
});

describe(deleteTrustEntryForTests, () => {
  it("rejects unsupported agents", () => {
    expect(() =>
      deleteTrustEntryForTests("/tmp/home", {
        agent: "invalid" as unknown as AgentTrustAgent,
        dirPath: "/tmp/ws",
        detail: "trusted",
        store: "/tmp/marker",
      }),
    ).toThrow("Unsupported trust agent: invalid");
  });
});

describe(agentUntrustDir, () => {
  let fakeHome: string;
  beforeEach(() => {
    fakeHome = mkdtempSync(path.join(os.tmpdir(), "agent-trust-untrust-"));
  });
  afterEach(() => {
    rmSync(fakeHome, { recursive: true, force: true });
  });

  it("throws when no target is provided", () => {
    expect(() => agentUntrustDir({ homeDir: fakeHome })).toThrow(
      "untrust requires all, path, or pathPrefix",
    );
  });

  it("deletes trust for an exact path", () => {
    const parentPath = path.resolve(fakeHome, "worktrees");
    const childPath = path.join(parentPath, "repo-team-1");
    mkdirSync(path.join(fakeHome, ".codex"), { recursive: true });
    writeFileSync(
      path.join(fakeHome, ".codex", "config.toml"),
      `${codexProjectTableHeader(childPath)}\ntrust_level = "trusted"\n`,
      "utf8",
    );

    const { results } = agentUntrustDir({ homeDir: fakeHome, path: childPath });
    expect(results).toEqual([
      { agent: "codex", dirPath: path.resolve(childPath), deleted: true },
    ]);
  });

  it("deletes every entry under a path prefix", () => {
    const parentPath = path.resolve(fakeHome, "worktrees");
    const childPath = path.join(parentPath, "repo-team-1");
    writeFileSync(
      path.join(fakeHome, ".claude.json"),
      JSON.stringify({
        projects: {
          [parentPath]: { hasTrustDialogAccepted: true },
          [childPath]: { hasTrustDialogAccepted: true },
          [path.resolve(fakeHome, "other")]: { hasTrustDialogAccepted: true },
        },
      }),
      "utf8",
    );

    const { results } = agentUntrustDir({
      homeDir: fakeHome,
      agent: "claude",
      pathPrefix: parentPath,
    });
    expect(results).toHaveLength(2);
    expect(results.every((result) => result.deleted)).toBe(true);
    expect(listAgentTrustedDirs({ homeDir: fakeHome, agent: "claude" })).toHaveLength(1);
  });

  it("deletes only markers matching a trustMethod", () => {
    const gcPath = path.resolve(fakeHome, "gc");
    const manualPath = path.resolve(fakeHome, "manual");
    for (const [workspacePath, trustMethod] of [
      [gcPath, TRUST_METHOD],
      [manualPath, "manual"],
    ] as const) {
      const markerPath = path.join(
        fakeHome,
        ".cursor",
        "projects",
        cursorProjectSlug(workspacePath),
        ".workspace-trusted",
      );
      mkdirSync(path.dirname(markerPath), { recursive: true });
      writeFileSync(markerPath, `${JSON.stringify({ workspacePath, trustMethod })}\n`, "utf8");
    }

    const { results } = agentUntrustDir({
      homeDir: fakeHome,
      agent: "cursor",
      all: true,
      trustMethod: TRUST_METHOD,
    });
    expect(results).toEqual([{ agent: "cursor", dirPath: gcPath, deleted: true }]);
    expect(listAgentTrustedDirs({ homeDir: fakeHome, agent: "cursor" })).toHaveLength(1);
    expect(listAgentTrustedDirs({ homeDir: fakeHome, agent: "cursor" })[0]?.dirPath).toBe(
      manualPath,
    );
  });

  it("returns no results when nothing matches", () => {
    const workspacePath = path.resolve(fakeHome, "claude-ws");
    writeFileSync(
      path.join(fakeHome, ".claude.json"),
      JSON.stringify({ projects: { [workspacePath]: { hasTrustDialogAccepted: true } } }),
      "utf8",
    );
    expect(
      agentUntrustDir({ homeDir: fakeHome, agent: "codex", path: workspacePath }).results,
    ).toEqual([]);
  });

  it("deletes Cursor trust using the listed marker path", () => {
    const workspacePath = path.resolve(fakeHome, "repo_with_underscore");
    const slug = "custom-cursor-slug";
    const markerPath = path.join(fakeHome, ".cursor", "projects", slug, ".workspace-trusted");
    mkdirSync(path.dirname(markerPath), { recursive: true });
    writeFileSync(markerPath, `${JSON.stringify({ workspacePath, trustMethod: "manual" })}\n`, "utf8");

    const { results } = agentUntrustDir({ homeDir: fakeHome, agent: "cursor", path: workspacePath });
    expect(results).toEqual([{ agent: "cursor", dirPath: workspacePath, deleted: true }]);
    expect(existsSync(markerPath)).toBe(false);
  });

  it("returns [] results when home cannot be resolved", () => {
    expect(
      agentUntrustDir({
        all: true,
        readHome: () => {
          throw new Error("no home");
        },
      }),
    ).toEqual({ results: [] });
  });

  it("preserves unrelated Claude fields when clearing trust", () => {
    const workspacePath = path.resolve(fakeHome, "claude-keep-fields");
    writeFileSync(
      path.join(fakeHome, ".claude.json"),
      JSON.stringify({
        projects: { [workspacePath]: { hasTrustDialogAccepted: true, note: "keep-me" } },
      }),
      "utf8",
    );

    agentUntrustDir({ homeDir: fakeHome, path: workspacePath });
    const projects = (
      JSON.parse(readFileSync(path.join(fakeHome, ".claude.json"), "utf8")) as {
        projects: Record<string, Record<string, unknown>>;
      }
    ).projects;
    expect(projects[workspacePath]).toEqual({ note: "keep-me" });
  });
});
