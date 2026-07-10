import path from "node:path";

import { isMissingAgentTrustedDir } from "./listAgentTrustedDirs.ts";
import { failMark, okMark, styleDim, styleWarning } from "./style.ts";
import type { AgentTrustAgent, AgentTrustedDir, AgentTrustMutationResult } from "./types.ts";

const AGENT_ORDER: readonly AgentTrustAgent[] = ["cursor", "claude", "codex"];
const UNPARSEABLE_CURSOR_DETAIL = "trusted (unparseable marker)";

export interface FormatAgentTrustedDirListOptions {
  homeDir: string;
  missingOnly?: boolean;
}

export interface FormatAgentTrustActionResultsOptions {
  homeDir: string;
  action: "remove" | "prune";
}

export function shortenDirPath(dirPath: string, homeDir: string): string {
  const resolved = path.resolve(dirPath);
  const home = path.resolve(homeDir);
  if (resolved === home) {
    return "~";
  }
  const homePrefix = home.endsWith(path.sep) ? home : `${home}${path.sep}`;
  if (resolved.startsWith(homePrefix)) {
    return `~${path.sep}${resolved.slice(homePrefix.length)}`;
  }
  return resolved;
}

function sectionBlock(title: string, lines: readonly string[]): string[] {
  if (lines.length === 0) {
    return [];
  }
  return [title, "-".repeat(title.length), ...lines, ""];
}

function formatListEntryLine(entry: AgentTrustedDir, homeDir: string): string {
  const shortPath = shortenDirPath(entry.dirPath, homeDir);
  if (entry.detail === UNPARSEABLE_CURSOR_DETAIL) {
    return `  ${styleWarning("⚠")}  ${shortPath}  ${styleDim("unparseable marker")}`;
  }
  if (isMissingAgentTrustedDir(entry)) {
    return `  ${failMark()}  ${shortPath}  ${styleDim("[missing]")}`;
  }
  return `  ${okMark()}  ${shortPath}`;
}

function countMissing(entries: readonly AgentTrustedDir[]): number {
  return entries.filter(isMissingAgentTrustedDir).length;
}

function agentSectionTitle(agent: AgentTrustAgent, count: number): string {
  const label = agent.charAt(0).toUpperCase() + agent.slice(1);
  return `${label} (${String(count)})`;
}

export function formatAgentTrustedDirList(
  entries: readonly AgentTrustedDir[],
  options: FormatAgentTrustedDirListOptions,
): string {
  if (entries.length === 0) {
    if (options.missingOnly === true) {
      return "No stale workspace trust entries.";
    }
    return "No workspace trust entries found.";
  }

  const missingCount = countMissing(entries);
  const header =
    options.missingOnly === true
      ? `Stale workspace trust (${String(entries.length)} ${entries.length === 1 ? "entry" : "entries"})`
      : missingCount > 0
        ? `Workspace trust (${String(entries.length)} ${entries.length === 1 ? "entry" : "entries"} · ${String(missingCount)} missing)`
        : `Workspace trust (${String(entries.length)} ${entries.length === 1 ? "entry" : "entries"})`;

  const lines: string[] = [header, ""];
  for (const agent of AGENT_ORDER) {
    const agentEntries = entries.filter((entry) => entry.agent === agent);
    lines.push(
      ...sectionBlock(
        agentSectionTitle(agent, agentEntries.length),
        agentEntries.map((entry) => formatListEntryLine(entry, options.homeDir)),
      ),
    );
  }

  return lines.join("\n").replace(/\n+$/u, "");
}

export function formatAgentTrustActionResults(
  results: readonly AgentTrustMutationResult[],
  options: FormatAgentTrustActionResultsOptions,
): string {
  if (results.length === 0) {
    return options.action === "prune"
      ? "No stale workspace trust entries."
      : "No matching workspace trust entries.";
  }

  const removed = results.filter((result) => result.deleted).length;
  const failed = results.length - removed;
  const removedNoun = removed === 1 ? "entry" : "entries";
  const header =
    options.action === "prune"
      ? `Pruned ${String(removed)} stale ${removedNoun}`
      : `Removed ${String(removed)} ${removedNoun}`;

  const lines: string[] = [header, ""];
  for (const result of results) {
    const shortPath = shortenDirPath(result.dirPath, options.homeDir);
    const mark = result.deleted ? okMark() : failMark();
    lines.push(`  ${mark}  ${result.agent}  ${shortPath}`);
  }

  if (failed > 0) {
    lines.push("", `Summary: ${String(removed)} removed · ${String(failed)} failed`);
  }

  return lines.join("\n");
}
