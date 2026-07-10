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
    const home = path.join(os.tmpdir(), "agent-trust-shorten-home");
    const repo = path.join(home, "dev", "repo");
    expect(shortenDirPath(repo, home)).toBe(`~${path.sep}dev${path.sep}repo`);
    expect(shortenDirPath(home, home)).toBe("~");
  });

  it("leaves paths outside the home directory unchanged", () => {
    const home = path.join(os.tmpdir(), "agent-trust-shorten-a");
    const outside = path.join(os.tmpdir(), "agent-trust-shorten-b", "ws");
    expect(shortenDirPath(outside, home)).toBe(path.resolve(outside));
  });

  it("handles home directories that already end with a separator", () => {
    const home = `${path.resolve(path.sep)}${path.sep}`;
    const child = path.join(path.resolve(path.sep), "foo", "bar");
    expect(shortenDirPath(child, home)).toBe(`~${path.sep}foo${path.sep}bar`);
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

  it("filters live paths out when missingOnly is requested", () => {
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
          agent: "codex",
          dirPath: missingPath,
          detail: "trust_level=trusted",
          store: `${fakeHome}/.codex/config.toml`,
        },
      ],
      { homeDir: fakeHome, missingOnly: true },
    );

    expect(formatted).toContain("Stale workspace trust (1 entry)");
    expect(formatted).toContain(shortenDirPath(missingPath, fakeHome));
    expect(formatted).not.toContain(shortenDirPath(existingPath, fakeHome));
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
  let fakeHome: string;

  beforeEach(() => {
    fakeHome = mkdtempSync(path.join(os.tmpdir(), "agent-trust-format-action-"));
  });

  afterEach(() => {
    rmSync(fakeHome, { recursive: true, force: true });
  });

  it("renders prune results without trust metadata", () => {
    const gone = path.join(fakeHome, "gone");
    const stuck = path.join(fakeHome, "stuck");
    const formatted = formatAgentTrustActionResults(
      [
        { agent: "claude", dirPath: gone, deleted: true },
        { agent: "cursor", dirPath: stuck, deleted: false },
      ],
      { homeDir: fakeHome, action: "prune" },
    );

    expect(formatted).toContain("Pruned 1 stale entry");
    expect(formatted).toContain(`✓  claude  ${shortenDirPath(gone, fakeHome)}`);
    expect(formatted).toContain(`✗  cursor  ${shortenDirPath(stuck, fakeHome)}`);
    expect(formatted).toContain("Summary: 1 removed · 1 failed");
  });

  it("prints mutation errors under failed rows", () => {
    const stuck = path.join(fakeHome, "stuck");
    const formatted = formatAgentTrustActionResults(
      [
        {
          agent: "codex",
          dirPath: stuck,
          deleted: false,
          error: "agent-trust: could not remove codex workspace trust",
        },
      ],
      { homeDir: fakeHome, action: "remove" },
    );

    expect(formatted).toContain(`✗  codex  ${shortenDirPath(stuck, fakeHome)}`);
    expect(formatted).toContain("agent-trust: could not remove codex workspace trust");
  });

  it("uses plural nouns when multiple entries are removed", () => {
    const one = path.join(fakeHome, "one");
    const two = path.join(fakeHome, "two");
    const formatted = formatAgentTrustActionResults(
      [
        { agent: "claude", dirPath: one, deleted: true },
        { agent: "codex", dirPath: two, deleted: true },
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
    const gone = path.join(fakeHome, "gone");
    const formatted = formatAgentTrustActionResults(
      [{ agent: "claude", dirPath: gone, deleted: true }],
      { homeDir: fakeHome, action: "remove" },
    );

    expect(formatted).toContain("Removed 1 entry");
    expect(formatted).not.toContain("Summary:");
  });
});
