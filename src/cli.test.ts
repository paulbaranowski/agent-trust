import { chmodSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { cursorProjectSlug } from "./agents/cursor.ts";
import { main } from "./cli.ts";

describe(main, () => {
  let fakeHome: string;

  beforeEach(() => {
    fakeHome = mkdtempSync(path.join(os.tmpdir(), "agent-trust-cli-"));
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    vi.spyOn(process.stderr, "write").mockImplementation((() => true) as typeof process.stderr.write);
    process.exitCode = undefined;
  });

  afterEach(() => {
    vi.restoreAllMocks();
    process.exitCode = undefined;
    rmSync(fakeHome, { recursive: true, force: true });
  });

  it("throws usage when no command is given", () => {
    expect(() => main([])).toThrow(/Usage:/);
  });

  it("throws a flag-oriented message when remove has no target", () => {
    expect(() => main(["remove", "--home", fakeHome])).toThrow(
      "remove requires --all, --path, or --prefix",
    );
  });

  it("throws when a flag is missing its value", () => {
    expect(() => main(["list", "--agent"])).toThrow("--agent requires a value");
  });

  it("adds cursor trust with the default trustMethod and lists it", () => {
    const workspacePath = path.join(fakeHome, "ws");
    main(["add", "--agent", "cursor", "--dir", workspacePath, "--home", fakeHome]);
    expect(process.exitCode).toBeUndefined();
    expect(console.log).toHaveBeenCalledWith(expect.stringContaining("Added cursor trust"));

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

    main(["list", "--home", fakeHome, "--agent", "cursor"]);
    expect(console.log).toHaveBeenCalledWith(expect.stringContaining("Workspace trust"));
  });

  it("passes --trust-method through on remove", () => {
    const groundcrewPath = path.resolve(fakeHome, "gc");
    const manualPath = path.resolve(fakeHome, "manual");
    main([
      "add",
      "--agent",
      "cursor",
      "--dir",
      groundcrewPath,
      "--home",
      fakeHome,
      "--trust-method",
      "groundcrew-auto-trust",
    ]);
    main([
      "add",
      "--agent",
      "cursor",
      "--dir",
      manualPath,
      "--home",
      fakeHome,
      "--trust-method",
      "manual",
    ]);

    main([
      "remove",
      "--all",
      "--agent",
      "cursor",
      "--home",
      fakeHome,
      "--trust-method",
      "groundcrew-auto-trust",
    ]);
    expect(console.log).toHaveBeenCalledWith(expect.stringContaining("Removed 1 entry"));

    main(["list", "--home", fakeHome, "--agent", "cursor"]);
    const logMock = vi.mocked(console.log);
    const listOutput = String(logMock.mock.calls.at(-1)?.[0] ?? "");
    expect(listOutput).toContain("manual");
    expect(listOutput).toMatch(/Workspace trust \(1 entry/);
  });

  it("exits 1 when add cannot write trust", () => {
    chmodSync(fakeHome, 0o500);
    try {
      main(["add", "--agent", "cursor", "--dir", path.join(fakeHome, "fail"), "--home", fakeHome]);
    } finally {
      chmodSync(fakeHome, 0o700);
    }
    expect(process.exitCode).toBe(1);
    expect(process.stderr.write).toHaveBeenCalledWith(
      expect.stringContaining("could not seed Cursor"),
    );
  });
});
