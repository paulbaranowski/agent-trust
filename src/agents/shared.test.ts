import {
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  symlinkSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { canonicalizeWorkspacePath } from "./shared.ts";

describe(canonicalizeWorkspacePath, () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(path.join(os.tmpdir(), "agent-trust-canon-"));
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it("returns realpath when the path exists (follows symlinks)", () => {
    const real = path.join(root, "real");
    const link = path.join(root, "link");
    mkdirSync(real);
    symlinkSync(real, link);
    expect(canonicalizeWorkspacePath(link)).toBe(realpathSync.native(link));
  });

  it("falls back to path.resolve when the path does not exist", () => {
    const missing = path.join(root, "nope");
    expect(canonicalizeWorkspacePath(missing)).toBe(path.resolve(missing));
  });
});
