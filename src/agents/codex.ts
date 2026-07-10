import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import type { AgentTrustEntry, TrustResult } from "../types.ts";
import { writeFileAtomic } from "./shared.ts";

const CODEX_TRUST_LEVEL = "trusted";
const CODEX_PROJECT_HEADER_PATTERN = /\[projects\."((?:[^"\\]|\\.)*)"\]/g;

function escapeTomlDoubleQuotedString(value: string): string {
  return value.replaceAll("\\", "\\\\").replaceAll('"', '\\"');
}

function unescapeTomlDoubleQuotedString(value: string): string {
  return value.replaceAll("\\\\", "\\").replaceAll('\\"', '"');
}

/** Codex keys per-workspace trust under `[projects."<abs-path>"]` in `config.toml`. */
export function codexProjectTableHeader(absoluteWorkspacePath: string): string {
  return `[projects."${escapeTomlDoubleQuotedString(absoluteWorkspacePath)}"]`;
}

function codexConfigPath(homeDir: string): string {
  return path.join(homeDir, ".codex", "config.toml");
}

function codexProjectSectionBody(config: string, headerIndex: number, headerLength: number): string {
  const afterHeader = config.slice(headerIndex + headerLength);
  const nextSection = afterHeader.search(/^\[/m);
  return nextSection === -1 ? afterHeader : afterHeader.slice(0, nextSection);
}

function hasCodexWorkspaceTrust(config: string, absoluteWorkspacePath: string): boolean {
  const header = codexProjectTableHeader(absoluteWorkspacePath);
  const headerIndex = config.indexOf(header);
  if (headerIndex === -1) {
    return false;
  }
  const sectionBody = codexProjectSectionBody(config, headerIndex, header.length);
  return /trust_level\s*=\s*"trusted"/.test(sectionBody);
}

function upsertCodexWorkspaceTrust(config: string, absoluteWorkspacePath: string): string {
  if (hasCodexWorkspaceTrust(config, absoluteWorkspacePath)) {
    return config;
  }

  const header = codexProjectTableHeader(absoluteWorkspacePath);
  const headerIndex = config.indexOf(header);
  if (headerIndex === -1) {
    const separator = config.length === 0 ? "" : config.endsWith("\n") ? "" : "\n";
    return `${config}${separator}${header}\ntrust_level = "${CODEX_TRUST_LEVEL}"\n`;
  }

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

function readCodexConfig(codexConfig: string): string {
  if (!existsSync(codexConfig)) {
    return "";
  }
  try {
    return readFileSync(codexConfig, "utf8");
  } catch {
    return "";
  }
}

export function ensureCodexTrust(input: {
  workspacePath: string;
  homeDir: string;
  trustMethod: string;
}): TrustResult {
  const absoluteWorkspacePath = path.resolve(input.workspacePath);
  const codexConfig = codexConfigPath(input.homeDir);
  const existing = readCodexConfig(codexConfig);
  const updated = upsertCodexWorkspaceTrust(existing, absoluteWorkspacePath);
  if (updated === existing) {
    return {
      ok: true,
      status: "already-trusted",
      agent: "codex",
      workspacePath: absoluteWorkspacePath,
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
      workspacePath: absoluteWorkspacePath,
    };
  }

  return {
    ok: true,
    status: "trusted",
    agent: "codex",
    workspacePath: absoluteWorkspacePath,
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
    const workspacePath = path.resolve(unescapeTomlDoubleQuotedString(rawPath));
    const header = match[0];
    const headerIndex = match.index;
    if (headerIndex === undefined) {
      continue;
    }
    const sectionBody = codexProjectSectionBody(config, headerIndex, header.length);
    const trustMatch = /trust_level\s*=\s*"([^"]*)"/.exec(sectionBody);
    if (trustMatch?.[1] === undefined) {
      continue;
    }
    entries.push({ path: workspacePath, trustLevel: trustMatch[1] });
  }
  return entries.toSorted((a, b) => a.path.localeCompare(b.path));
}

export function listCodexTrustEntries(homeDir: string): AgentTrustEntry[] {
  const codexConfig = codexConfigPath(homeDir);
  return listCodexTrustedProjects(readCodexConfig(codexConfig)).map((entry) => ({
    agent: "codex" as const,
    workspacePath: entry.path,
    detail: `trust_level=${entry.trustLevel}`,
    store: codexConfig,
  }));
}

export function removeCodexProjectTrust(config: string, absoluteWorkspacePath: string): string {
  const header = codexProjectTableHeader(absoluteWorkspacePath);
  const headerIndex = config.indexOf(header);
  if (headerIndex === -1) {
    return config;
  }

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

export function deleteCodexTrustEntry(homeDir: string, workspacePath: string): boolean {
  const codexConfig = codexConfigPath(homeDir);
  const existing = readCodexConfig(codexConfig);
  const updated = removeCodexProjectTrust(existing, workspacePath);
  if (updated !== existing) {
    writeFileAtomic(codexConfig, updated);
  }
  return updated !== existing;
}
