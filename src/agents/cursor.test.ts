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
  cursorProjectSlugFromResolved,
  deleteCursorTrustEntry,
  ensureCursorTrust,
  listCursorTrustEntries,
} from "./cursor.ts";

describe(cursorProjectSlug, () => {
  it("strips the leading slash and replaces path separators with dashes", () => {
    expect(cursorProjectSlug("/Users/dev/repo/worktree")).toBe("Users-dev-repo-worktree");
  });

  it("replaces Windows-illegal path characters in the slug", () => {
    expect(cursorProjectSlug(String.raw`C:\Users\dev\repo`)).toBe("C-Users-dev-repo");
  });

  it("still maps POSIX paths like groundcrew", () => {
    expect(cursorProjectSlug("/Users/dev/repo/worktree")).toBe("Users-dev-repo-worktree");
  });
});

describe(cursorProjectSlugFromResolved, () => {
  it("normalizes Windows-style separators and drive letters", () => {
    expect(cursorProjectSlugFromResolved(String.raw`C:\Users\dev\repo`)).toBe("C-Users-dev-repo");
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
      dirPath: path.resolve(workspacePath),
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

  it("treats Windows slash variants as the same already-trusted path", () => {
    const nativePath = String.raw`C:\Users\dev\repo`;
    const slashPath = "C:/Users/dev/repo";
    expect(cursorProjectSlug(nativePath)).toBe(cursorProjectSlug(slashPath));

    const first = ensureCursorTrust({
      workspacePath: nativePath,
      homeDir: fakeHome,
      trustMethod: "agent-trust",
    });
    expect(first.status).toBe("trusted");

    const markerPath = path.join(
      fakeHome,
      ".cursor",
      "projects",
      cursorProjectSlug(nativePath),
      ".workspace-trusted",
    );
    const before = readFileSync(markerPath, "utf8");
    const second = ensureCursorTrust({
      workspacePath: slashPath,
      homeDir: fakeHome,
      trustMethod: "other-method",
    });
    expect(second.status).toBe("already-trusted");
    expect(readFileSync(markerPath, "utf8")).toBe(before);
  });

  it("rewrites a slug-colliding marker when the recorded path differs", () => {
    const firstPath = path.join(fakeHome, "a", "b");
    const secondPath = path.join(fakeHome, "a-b");
    expect(cursorProjectSlug(firstPath)).toBe(cursorProjectSlug(secondPath));

    const markerPath = path.join(
      fakeHome,
      ".cursor",
      "projects",
      cursorProjectSlug(firstPath),
      ".workspace-trusted",
    );
    mkdirSync(path.dirname(markerPath), { recursive: true });
    writeFileSync(
      markerPath,
      `${JSON.stringify({
        workspacePath: path.resolve(firstPath),
        trustMethod: "first",
      })}\n`,
      "utf8",
    );

    const result = ensureCursorTrust({
      workspacePath: secondPath,
      homeDir: fakeHome,
      trustMethod: "second",
    });
    expect(result).toMatchObject({ ok: true, status: "trusted", agent: "cursor" });
    const marker = JSON.parse(readFileSync(markerPath, "utf8")) as {
      workspacePath: string;
      trustMethod: string;
    };
    expect(marker.workspacePath).toBe(path.resolve(secondPath));
    expect(marker.trustMethod).toBe("second");
  });

  it("returns an error result when the marker cannot be written", () => {
    if (typeof process.getuid === "function" && process.getuid() === 0) {
      return;
    }
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

  it("returns [] when the projects dir is unreadable", () => {
    if (process.getuid?.() === 0) {
      return; // permission bits are bypassed for root
    }
    const projectsDir = path.join(fakeHome, ".cursor", "projects");
    mkdirSync(projectsDir, { recursive: true });
    chmodSync(path.join(fakeHome, ".cursor"), 0o000);
    expect(listCursorTrustEntries(fakeHome)).toEqual([]);
    chmodSync(path.join(fakeHome, ".cursor"), 0o700);
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
        expect.objectContaining({ agent: "cursor", dirPath: explicitPath, detail: "trusted" }),
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
