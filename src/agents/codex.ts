import { readFileSync } from "node:fs";
import path from "node:path";

import type { AgentTrustedDir, AgentTrustDirResult } from "../types.ts";
import {
  canonicalizeWorkspacePath,
  resolveCodexHome,
  writeFileAtomic,
} from "./shared.ts";

export { resolveCodexHome } from "./shared.ts";

const CODEX_TRUST_LEVEL = "trusted";
/** Match `[projects.<json-string>]` headers written via JSON.stringify. */
const CODEX_PROJECT_HEADER_PATTERN = /\[projects\.("(?:[^"\\]|\\.)*")\]/g;

/** Codex keys per-workspace trust under `[projects.<json-path>]` in `config.toml`. */
export function codexProjectTableHeader(absoluteWorkspacePath: string): string {
  return `[projects.${JSON.stringify(absoluteWorkspacePath)}]`;
}

/** Pre-0.2.0 header shape: TOML-escaped double-quoted path (kept for read/delete compat). */
function legacyCodexProjectTableHeader(absoluteWorkspacePath: string): string {
  const escaped = absoluteWorkspacePath.replaceAll("\\", "\\\\").replaceAll('"', '\\"');
  return `[projects."${escaped}"]`;
}

/** Modern + legacy headers that may identify the same workspace on disk. */
function codexHeadersForWorkspace(absoluteWorkspacePath: string): string[] {
  return [
    codexProjectTableHeader(absoluteWorkspacePath),
    legacyCodexProjectTableHeader(absoluteWorkspacePath),
  ];
}

function findCodexHeaderIndex(
  config: string,
  absoluteWorkspacePath: string,
): { header: string; headerIndex: number } | undefined {
  for (const header of codexHeadersForWorkspace(absoluteWorkspacePath)) {
    const headerIndex = config.indexOf(header);
    if (headerIndex !== -1) {
      return { header, headerIndex };
    }
  }
  return undefined;
}

function parseCodexProjectPathKey(jsonQuotedPath: string): string {
  try {
    const parsed: unknown = JSON.parse(jsonQuotedPath);
    if (typeof parsed === "string") {
      return parsed;
    }
  } catch {
    // fall through to raw strip for legacy headers
  }
  return jsonQuotedPath.slice(1, -1).replaceAll("\\\\", "\\").replaceAll('\\"', '"');
}

function codexConfigPath(homeDir: string, codexHome?: string, env?: NodeJS.ProcessEnv): string {
  return path.join(resolveCodexHome({ homeDir, codexHome, env }), "config.toml");
}

function codexProjectSectionBody(config: string, headerIndex: number, headerLength: number): string {
  const afterHeader = config.slice(headerIndex + headerLength);
  const nextSection = afterHeader.search(/^\[/m);
  return nextSection === -1 ? afterHeader : afterHeader.slice(0, nextSection);
}

function hasCodexWorkspaceTrust(config: string, absoluteWorkspacePath: string): boolean {
  const found = findCodexHeaderIndex(config, absoluteWorkspacePath);
  if (found === undefined) {
    return false;
  }
  const sectionBody = codexProjectSectionBody(config, found.headerIndex, found.header.length);
  return /trust_level\s*=\s*"trusted"/.test(sectionBody);
}

function upsertCodexWorkspaceTrust(config: string, absoluteWorkspacePath: string): string {
  if (hasCodexWorkspaceTrust(config, absoluteWorkspacePath)) {
    return config;
  }

  const found = findCodexHeaderIndex(config, absoluteWorkspacePath);
  if (found === undefined) {
    const header = codexProjectTableHeader(absoluteWorkspacePath);
    const separator = config.length === 0 ? "" : config.endsWith("\n") ? "" : "\n";
    return `${config}${separator}${header}\ntrust_level = "${CODEX_TRUST_LEVEL}"\n`;
  }

  const { header, headerIndex } = found;
  const sectionBody = codexProjectSectionBody(config, headerIndex, header.length);
  const sectionEnd = headerIndex + header.length + sectionBody.length;
  if (/trust_level\s*=/.test(sectionBody)) {
    const updatedSection = sectionBody.replace(
      /trust_level\s*=\s*"[^"]*"/,
      `trust_level = "${CODEX_TRUST_LEVEL}"`,
    );
    return `${config.slice(0, headerIndex + header.length)}${updatedSection}${config.slice(sectionEnd)}`;
  }

  const insertion = sectionBody.endsWith("\n")
    ? `trust_level = "${CODEX_TRUST_LEVEL}"\n`
    : `\ntrust_level = "${CODEX_TRUST_LEVEL}"\n`;
  return `${config.slice(0, sectionEnd)}${insertion}${config.slice(sectionEnd)}`;
}

function isEnoent(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === "ENOENT"
  );
}

/** Read Codex config; missing file is empty. Other I/O errors propagate. */
function readCodexConfig(codexConfig: string): string {
  try {
    return readFileSync(codexConfig, "utf8");
  } catch (error) {
    if (isEnoent(error)) {
      return "";
    }
    throw error;
  }
}

export function ensureCodexTrust(input: {
  workspacePath: string;
  homeDir: string;
  trustMethod: string;
  codexHome?: string;
  env?: NodeJS.ProcessEnv;
}): AgentTrustDirResult {
  const absoluteWorkspacePath = canonicalizeWorkspacePath(input.workspacePath);
  const codexConfig = codexConfigPath(input.homeDir, input.codexHome, input.env);
  let existing: string;
  try {
    existing = readCodexConfig(codexConfig);
  } catch (error) {
    return {
      ok: false,
      status: "error",
      error: `agent-trust: could not seed Codex workspace trust for ${absoluteWorkspacePath} (${String(error)})`,
      agent: "codex",
      dirPath: absoluteWorkspacePath,
    };
  }
  const updated = upsertCodexWorkspaceTrust(existing, absoluteWorkspacePath);
  if (updated === existing) {
    return {
      ok: true,
      status: "already-trusted",
      agent: "codex",
      dirPath: absoluteWorkspacePath,
    };
  }

  try {
    writeFileAtomic(codexConfig, updated);
  } catch (error) {
    return {
      ok: false,
      status: "error",
      error: `agent-trust: could not seed Codex workspace trust for ${absoluteWorkspacePath} (${String(error)})`,
      agent: "codex",
      dirPath: absoluteWorkspacePath,
    };
  }

  return {
    ok: true,
    status: "trusted",
    agent: "codex",
    dirPath: absoluteWorkspacePath,
  };
}

export function listCodexTrustedProjects(
  config: string,
): Array<{ path: string; trustLevel: string }> {
  const entries: Array<{ path: string; trustLevel: string }> = [];
  for (const match of config.matchAll(CODEX_PROJECT_HEADER_PATTERN)) {
    const rawPath = match[1];
    if (rawPath === undefined) {
      continue;
    }
    const workspacePath = canonicalizeWorkspacePath(parseCodexProjectPathKey(rawPath));
    const header = match[0];
    const headerIndex = match.index;
    if (headerIndex === undefined) {
      continue;
    }
    const sectionBody = codexProjectSectionBody(config, headerIndex, header.length);
    const trustMatch = /trust_level\s*=\s*"([^"]*)"/.exec(sectionBody);
    if (trustMatch?.[1] !== "trusted") {
      continue;
    }
    entries.push({ path: workspacePath, trustLevel: trustMatch[1] });
  }
  return entries.toSorted((a, b) => a.path.localeCompare(b.path));
}

export function listCodexTrustEntries(
  homeDir: string,
  options: { codexHome?: string; env?: NodeJS.ProcessEnv } = {},
): AgentTrustedDir[] {
  const codexConfig = codexConfigPath(homeDir, options.codexHome, options.env);
  let config: string;
  try {
    config = readCodexConfig(codexConfig);
  } catch {
    // Match Claude list readers: degrade to [] on permission / I/O failures.
    return [];
  }
  return listCodexTrustedProjects(config).map((entry) => ({
    agent: "codex" as const,
    dirPath: entry.path,
    detail: `trust_level=${entry.trustLevel}`,
    store: codexConfig,
  }));
}

export function removeCodexProjectTrust(config: string, absoluteWorkspacePath: string): string {
  const found = findCodexHeaderIndex(config, absoluteWorkspacePath);
  if (found === undefined) {
    return config;
  }

  const { header, headerIndex } = found;
  const sectionBody = codexProjectSectionBody(config, headerIndex, header.length);
  const sectionEnd = headerIndex + header.length + sectionBody.length;
  const withoutTrust = sectionBody.replace(/^\s*trust_level\s*=\s*"[^"]*"\s*\n?/m, "");
  const remainingKeys = withoutTrust
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  if (remainingKeys.length === 0) {
    let updated = `${config.slice(0, headerIndex)}${config.slice(sectionEnd)}`;
    updated = updated.replaceAll(/\n{3,}/g, "\n\n").replace(/\n+$/u, "\n");
    return updated;
  }

  return `${config.slice(0, headerIndex + header.length)}${withoutTrust}${config.slice(sectionEnd)}`;
}

export function deleteCodexTrustEntry(
  homeDir: string,
  workspacePath: string,
  options: { codexHome?: string; env?: NodeJS.ProcessEnv } = {},
): boolean {
  const codexConfig = codexConfigPath(homeDir, options.codexHome, options.env);
  const existing = readCodexConfig(codexConfig);
  const updated = removeCodexProjectTrust(existing, canonicalizeWorkspacePath(workspacePath));
  if (updated !== existing) {
    writeFileAtomic(codexConfig, updated);
  }
  return updated !== existing;
}
