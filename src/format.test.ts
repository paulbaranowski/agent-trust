import { existsSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  formatAgentTrustActionResults,
  formatAgentTrustedDirList,
  shortenDirPath,
} from "./format.ts";

describe(shortenDirPath, () => {
  it("replaces the home directory prefix with tilde", () => {
    const home = "/Users/test";
    expect(shortenDirPath("/Users/test/dev/repo", home)).toBe("~/dev/repo");
    expect(shortenDirPath("/Users/test", home)).toBe("~");
  });

  it("leaves paths outside the home directory unchanged", () => {
    expect(shortenDirPath("/tmp/ws", "/Users/test")).toBe("/tmp/ws");
  });

  it("handles home directories that already end with a separator", () => {
    expect(shortenDirPath("/foo/bar", "/")).toBe(`~${path.sep}foo${path.sep}bar`);
  });
});

describe(formatAgentTrustedDirList, () => {
  let fakeHome: string;
  let existingPath: string;

  beforeEach(() => {
    fakeHome = mkdtempSync(path.join(os.tmpdir(), "agent-trust-format-"));
    existingPath = path.join(fakeHome, "still-here");
    mkdirSync(existingPath, { recursive: true });
  });

  afterEach(() => {
    rmSync(fakeHome, { recursive: true, force: true });
  });

  it("groups entries by agent without redundant trust detail lines", () => {
    const missingPath = path.join(fakeHome, "gone");
    const formatted = formatAgentTrustedDirList(
      [
        {
          agent: "claude",
          dirPath: existingPath,
          detail: "hasTrustDialogAccepted",
          store: `${fakeHome}/.claude.json#projects`,
        },
        {
          agent: "cursor",
          dirPath: missingPath,
          detail: "agent-trust",
          store: `${fakeHome}/.cursor/projects/slug/.workspace-trusted`,
        },
      ],
      { homeDir: fakeHome },
    );

    expect(formatted).toContain("Workspace trust (2 entries · 1 missing)");
    expect(formatted).toContain("Claude (1)");
    expect(formatted).toContain(`✓  ${shortenDirPath(existingPath, fakeHome)}`);
    expect(formatted).toContain("Cursor (1)");
    expect(formatted).toContain(`✗  ${shortenDirPath(missingPath, fakeHome)}`);
    expect(formatted).toContain("[missing]");
    expect(formatted).not.toContain("hasTrustDialogAccepted");
    expect(formatted).not.toContain("agent-trust\n");
  });

  it("uses a singular header when one listed entry is missing", () => {
    const missingPath = path.join(fakeHome, "gone");
    const formatted = formatAgentTrustedDirList(
      [
        {
          agent: "claude",
          dirPath: missingPath,
          detail: "hasTrustDialogAccepted",
          store: `${fakeHome}/.claude.json#projects`,
        },
      ],
      { homeDir: fakeHome },
    );

    expect(formatted).toContain("Workspace trust (1 entry · 1 missing)");
  });

  it("shows a warning only for unparseable Cursor markers", () => {
    const formatted = formatAgentTrustedDirList(
      [
        {
          agent: "cursor",
          dirPath: existingPath,
          detail: "trusted (unparseable marker)",
          store: `${fakeHome}/.cursor/projects/slug/.workspace-trusted`,
        },
      ],
      { homeDir: fakeHome },
    );

    expect(formatted).toContain("⚠");
    expect(formatted).toContain("unparseable marker");
    expect(existsSync(existingPath)).toBe(true);
  });

  it("uses a stale header when listing missing entries only", () => {
    const formatted = formatAgentTrustedDirList(
      [
        {
          agent: "codex",
          dirPath: path.join(fakeHome, "gone"),
          detail: "trust_level=trusted",
          store: `${fakeHome}/.codex/config.toml`,
        },
      ],
      { homeDir: fakeHome, missingOnly: true },
    );

    expect(formatted).toContain("Stale workspace trust (1 entry)");
    expect(formatted).not.toContain("trust_level");
  });

  it("uses plural stale headers and omits missing counts when all paths exist", () => {
    const firstPath = path.join(fakeHome, "one");
    const secondPath = path.join(fakeHome, "two");
    mkdirSync(firstPath, { recursive: true });
    mkdirSync(secondPath, { recursive: true });

    const staleFormatted = formatAgentTrustedDirList(
      [
        {
          agent: "claude",
          dirPath: path.join(fakeHome, "gone-1"),
          detail: "hasTrustDialogAccepted",
          store: `${fakeHome}/.claude.json#projects`,
        },
        {
          agent: "codex",
          dirPath: path.join(fakeHome, "gone-2"),
          detail: "trust_level=trusted",
          store: `${fakeHome}/.codex/config.toml`,
        },
      ],
      { homeDir: fakeHome, missingOnly: true },
    );
    expect(staleFormatted).toContain("Stale workspace trust (2 entries)");

    const allPresentFormatted = formatAgentTrustedDirList(
      [
        {
          agent: "claude",
          dirPath: firstPath,
          detail: "hasTrustDialogAccepted",
          store: `${fakeHome}/.claude.json#projects`,
        },
        {
          agent: "codex",
          dirPath: secondPath,
          detail: "trust_level=trusted",
          store: `${fakeHome}/.codex/config.toml`,
        },
      ],
      { homeDir: fakeHome },
    );
    expect(allPresentFormatted).toContain("Workspace trust (2 entries)");
    expect(allPresentFormatted).not.toContain("missing");
  });

  it("reports when list is empty", () => {
    expect(formatAgentTrustedDirList([], { homeDir: fakeHome })).toBe(
      "No workspace trust entries found.",
    );
  });

  it("reports when stale list is empty", () => {
    expect(formatAgentTrustedDirList([], { homeDir: fakeHome, missingOnly: true })).toBe(
      "No stale workspace trust entries.",
    );
  });
});

describe(formatAgentTrustActionResults, () => {
  const fakeHome = "/Users/test";

  it("renders prune results without trust metadata", () => {
    const formatted = formatAgentTrustActionResults(
      [
        { agent: "claude", dirPath: "/Users/test/gone", deleted: true },
        { agent: "cursor", dirPath: "/Users/test/stuck", deleted: false },
      ],
      { homeDir: fakeHome, action: "prune" },
    );

    expect(formatted).toContain("Pruned 1 stale entry");
    expect(formatted).toContain("✓  claude  ~/gone");
    expect(formatted).toContain("✗  cursor  ~/stuck");
    expect(formatted).toContain("Summary: 1 removed · 1 failed");
  });

  it("uses plural nouns when multiple entries are removed", () => {
    const formatted = formatAgentTrustActionResults(
      [
        { agent: "claude", dirPath: "/Users/test/one", deleted: true },
        { agent: "codex", dirPath: "/Users/test/two", deleted: true },
      ],
      { homeDir: fakeHome, action: "prune" },
    );

    expect(formatted).toContain("Pruned 2 stale entries");
  });

  it("reports when remove finds no matches", () => {
    expect(formatAgentTrustActionResults([], { homeDir: fakeHome, action: "remove" })).toBe(
      "No matching workspace trust entries.",
    );
  });

  it("reports when prune finds nothing to remove", () => {
    expect(formatAgentTrustActionResults([], { homeDir: fakeHome, action: "prune" })).toBe(
      "No stale workspace trust entries.",
    );
  });

  it("renders remove results without a failure summary when everything succeeds", () => {
    const formatted = formatAgentTrustActionResults(
      [{ agent: "claude", dirPath: "/Users/test/gone", deleted: true }],
      { homeDir: fakeHome, action: "remove" },
    );

    expect(formatted).toContain("Removed 1 entry");
    expect(formatted).not.toContain("Summary:");
  });
});
