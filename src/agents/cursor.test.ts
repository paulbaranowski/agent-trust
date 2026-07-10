import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  cursorProjectSlug,
  deleteCursorTrustEntry,
  ensureCursorTrust,
  listCursorTrustEntries,
} from "./cursor.ts";

describe(cursorProjectSlug, () => {
  it("strips the leading slash and replaces path separators with dashes", () => {
    expect(cursorProjectSlug("/Users/dev/repo/worktree")).toBe("Users-dev-repo-worktree");
  });
});

describe(ensureCursorTrust, () => {
  let fakeHome: string;
  beforeEach(() => {
    fakeHome = mkdtempSync(path.join(os.tmpdir(), "agent-trust-cursor-"));
  });
  afterEach(() => {
    rmSync(fakeHome, { recursive: true, force: true });
  });

  it("creates a marker with the given trustMethod", () => {
    const workspacePath = path.join(fakeHome, "ws");
    const result = ensureCursorTrust({
      workspacePath,
      homeDir: fakeHome,
      trustMethod: "agent-trust",
    });
    expect(result).toEqual({
      ok: true,
      status: "trusted",
      agent: "cursor",
      workspacePath: path.resolve(workspacePath),
    });
    const markerPath = path.join(
      fakeHome,
      ".cursor",
      "projects",
      cursorProjectSlug(workspacePath),
      ".workspace-trusted",
    );
    const marker = JSON.parse(readFileSync(markerPath, "utf8")) as {
      trustMethod: string;
      workspacePath: string;
    };
    expect(marker.trustMethod).toBe("agent-trust");
    expect(marker.workspacePath).toBe(path.resolve(workspacePath));
  });

  it("returns already-trusted when marker exists", () => {
    const workspacePath = path.join(fakeHome, "ws2");
    const markerPath = path.join(
      fakeHome,
      ".cursor",
      "projects",
      cursorProjectSlug(workspacePath),
      ".workspace-trusted",
    );
    mkdirSync(path.dirname(markerPath), { recursive: true });
    writeFileSync(markerPath, '{"trustMethod":"existing"}\n', "utf8");
    const result = ensureCursorTrust({
      workspacePath,
      homeDir: fakeHome,
      trustMethod: "agent-trust",
    });
    expect(result.status).toBe("already-trusted");
    expect(readFileSync(markerPath, "utf8")).toBe('{"trustMethod":"existing"}\n');
  });

  it("returns an error result when the marker cannot be written", () => {
    const workspacePath = path.join(fakeHome, "cursor-write-fail");
    mkdirSync(path.join(fakeHome, ".cursor", "projects"), { recursive: true });
    chmodSync(path.join(fakeHome, ".cursor", "projects"), 0o500);

    const result = ensureCursorTrust({
      workspacePath,
      homeDir: fakeHome,
      trustMethod: "agent-trust",
    });

    chmodSync(path.join(fakeHome, ".cursor", "projects"), 0o700);
    expect(result).toMatchObject({
      ok: false,
      status: "error",
      agent: "cursor",
    });
    if (!result.ok) {
      expect(result.error).toContain("agent-trust:");
    }
  });
});

describe(listCursorTrustEntries, () => {
  let fakeHome: string;
  beforeEach(() => {
    fakeHome = mkdtempSync(path.join(os.tmpdir(), "agent-trust-cursor-list-"));
  });
  afterEach(() => {
    rmSync(fakeHome, { recursive: true, force: true });
  });

  it("returns [] when the projects dir is absent", () => {
    expect(listCursorTrustEntries(fakeHome)).toEqual([]);
  });

  it("lists markers, using detail from trustMethod or unparseable fallback", () => {
    const explicitPath = path.resolve(fakeHome, "explicit-path");
    mkdirSync(path.join(fakeHome, ".cursor", "projects", "fallback-slug"), { recursive: true });
    writeFileSync(
      path.join(fakeHome, ".cursor", "projects", "fallback-slug", ".workspace-trusted"),
      `${JSON.stringify({ workspacePath: explicitPath })}\n`,
      "utf8",
    );
    mkdirSync(path.join(fakeHome, ".cursor", "projects", "trust-method-only"), { recursive: true });
    writeFileSync(
      path.join(fakeHome, ".cursor", "projects", "trust-method-only", ".workspace-trusted"),
      `${JSON.stringify({ trustMethod: "manual" })}\n`,
      "utf8",
    );
    mkdirSync(path.join(fakeHome, ".cursor", "projects", "bad-slug"), { recursive: true });
    writeFileSync(
      path.join(fakeHome, ".cursor", "projects", "bad-slug", ".workspace-trusted"),
      "not-json",
      "utf8",
    );
    mkdirSync(path.join(fakeHome, ".cursor", "projects", "no-marker"), { recursive: true });

    const entries = listCursorTrustEntries(fakeHome);
    expect(entries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ agent: "cursor", workspacePath: explicitPath, detail: "trusted" }),
        expect.objectContaining({ agent: "cursor", detail: "manual" }),
        expect.objectContaining({ agent: "cursor", detail: "trusted (unparseable marker)" }),
      ]),
    );
    expect(entries).toHaveLength(3);
  });
});

describe(deleteCursorTrustEntry, () => {
  it("returns false when the marker file is already gone", () => {
    expect(deleteCursorTrustEntry("/tmp/agent-trust-missing-marker")).toBe(false);
  });

  it("removes an existing marker", () => {
    const fakeHome = mkdtempSync(path.join(os.tmpdir(), "agent-trust-cursor-del-"));
    const markerPath = path.join(fakeHome, ".cursor", "projects", "slug", ".workspace-trusted");
    mkdirSync(path.dirname(markerPath), { recursive: true });
    writeFileSync(markerPath, "{}\n", "utf8");
    expect(deleteCursorTrustEntry(markerPath)).toBe(true);
    expect(existsSync(markerPath)).toBe(false);
    rmSync(fakeHome, { recursive: true, force: true });
  });
});
