#!/usr/bin/env node

import { homedir } from "node:os";

import { agentTrustDir, resolveDirPath } from "./agentTrustDir.ts";
import { agentUntrustDir } from "./agentUntrustDir.ts";
import {
  formatAgentTrustActionResults,
  formatAgentTrustedDirList,
  shortenDirPath,
} from "./format.ts";
import { listAgentTrustedDirs } from "./listAgentTrustedDirs.ts";
import { normalizeAgent } from "./normalize.ts";
import { pruneAgentTrustedDirs } from "./pruneAgentTrustedDirs.ts";
import type { AgentTrustAgent } from "./types.ts";

const USAGE = `Usage:
  agent-trust list [PATH] [--agent cursor|claude|codex] [--missing] [--home <dir>]
  agent-trust add --agent <cursor|cursor-agent|claude|codex> [--dir <abs>] [--home <dir>] [--trust-method <value>]
  agent-trust remove (--all | --path <abs> | --prefix <dir>)
    [--agent cursor|claude|codex] [--trust-method <value>] [--home <dir>]
  agent-trust prune [--agent cursor|claude|codex] [--home <dir>]

Examples:
  agent-trust list
  agent-trust list .
  agent-trust list --missing
  agent-trust add --agent claude --dir "$PWD"
  agent-trust add --agent codex --dir "$PWD"
  agent-trust remove --path "$HOME/worktrees/repo-team-1"
  agent-trust remove --all --agent cursor --trust-method groundcrew-auto-trust
  agent-trust prune`;

class CliExitError extends Error {
  readonly exitCode: number;

  constructor(message: string, exitCode: number) {
    super(message);
    this.exitCode = exitCode;
  }
}
interface ParsedArguments {
  command?: "list" | "add" | "remove" | "prune";
  agent?: AgentTrustAgent;
  homeDir: string;
  dirPath?: string;
  /** Optional positional path for `list` (exact-match filter). */
  listPath?: string;
  path?: string;
  pathPrefix?: string;
  trustMethod?: string;
  all: boolean;
  missingOnly: boolean;
}

function parseAgent(value: string): AgentTrustAgent {
  const normalized = normalizeAgent(value);
  if (!normalized.ok) {
    throw new Error(`Unknown agent: ${value}`);
  }
  return normalized.agent;
}

function readFlagValue(argv: readonly string[], index: number, flag: string): string {
  const value = argv[index + 1];
  if (value === undefined || value.startsWith("-")) {
    throw new Error(`${flag} requires a value`);
  }
  return value;
}

function applyArgument(
  parsed: ParsedArguments,
  arg: string,
  argv: readonly string[],
  index: number,
): number {
  switch (arg) {
    case "list":
    case "add":
    case "remove":
    case "prune": {
      parsed.command = arg;
      return index;
    }
    case "--agent": {
      parsed.agent = parseAgent(readFlagValue(argv, index, arg));
      return index + 1;
    }
    case "--home": {
      parsed.homeDir = readFlagValue(argv, index, arg);
      return index + 1;
    }
    case "--path": {
      parsed.path = readFlagValue(argv, index, arg);
      return index + 1;
    }
    case "--dir": {
      parsed.dirPath = readFlagValue(argv, index, arg);
      return index + 1;
    }
    case "--prefix": {
      parsed.pathPrefix = readFlagValue(argv, index, arg);
      return index + 1;
    }
    case "--trust-method": {
      parsed.trustMethod = readFlagValue(argv, index, arg);
      return index + 1;
    }
    case "--all": {
      parsed.all = true;
      return index;
    }
    case "--missing": {
      parsed.missingOnly = true;
      return index;
    }
    case "--help":
    case "-h": {
      throw new CliExitError(USAGE, 0);
    }
    default: {
      if (!arg.startsWith("-") && parsed.command === "list") {
        if (parsed.listPath !== undefined) {
          throw new Error(`Unexpected argument: ${arg}\n\n${USAGE}`);
        }
        parsed.listPath = arg;
        return index;
      }
      throw new Error(`Unknown argument: ${arg}\n\n${USAGE}`);
    }
  }
}

function parseArguments(argv: readonly string[]): ParsedArguments {
  const parsed: ParsedArguments = {
    homeDir: homedir(),
    all: false,
    missingOnly: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === undefined) {
      continue;
    }
    index = applyArgument(parsed, arg, argv, index);
  }

  if (parsed.command === undefined) {
    throw new CliExitError(USAGE, 1);
  }
  return parsed;
}

function runAdd(parsed: ParsedArguments): void {
  if (parsed.agent === undefined) {
    throw new Error("add requires --agent");
  }
  const dirPath = resolveDirPath(
    parsed.dirPath === undefined ? {} : { dirPath: parsed.dirPath },
  );
  const result = agentTrustDir({
    agent: parsed.agent,
    dirPath,
    homeDir: parsed.homeDir,
    ...(parsed.trustMethod === undefined ? {} : { trustMethod: parsed.trustMethod }),
  });

  const shortPath = shortenDirPath(dirPath, parsed.homeDir);
  switch (result.status) {
    case "trusted":
      console.log(`Added ${result.agent} trust for ${shortPath}`);
      return;
    case "already-trusted":
      console.log(`${result.agent} already trusts ${shortPath}`);
      return;
    case "skipped":
      process.stderr.write(`Skipped unknown agent: ${result.agentCommandName}\n`);
      return;
    case "error":
      process.stderr.write(`${result.error}\n`);
      process.exitCode = 1;
      return;
  }
}

/** CLI entry used by the bin wrapper and unit tests. */
export function main(argv: readonly string[]): void {
  const parsed = parseArguments(argv);

  if (parsed.command === "list") {
    const listDirPath =
      parsed.listPath === undefined
        ? undefined
        : resolveDirPath({ dirPath: parsed.listPath });
    const entries = listAgentTrustedDirs({
      homeDir: parsed.homeDir,
      missingOnly: parsed.missingOnly,
      ...(parsed.agent === undefined ? {} : { agent: parsed.agent }),
      ...(listDirPath === undefined ? {} : { dirPath: listDirPath }),
    });
    console.log(
      formatAgentTrustedDirList(entries, {
        homeDir: parsed.homeDir,
        missingOnly: parsed.missingOnly,
        ...(listDirPath === undefined ? {} : { dirPath: listDirPath }),
      }),
    );
    return;
  }

  if (parsed.command === "add") {
    runAdd(parsed);
    return;
  }

  if (parsed.command === "prune") {
    const { results } = pruneAgentTrustedDirs({
      homeDir: parsed.homeDir,
      ...(parsed.agent === undefined ? {} : { agent: parsed.agent }),
    });
    console.log(
      formatAgentTrustActionResults(results, { homeDir: parsed.homeDir, action: "prune" }),
    );
    return;
  }

  const hasTarget =
    parsed.all === true || parsed.path !== undefined || parsed.pathPrefix !== undefined;
  if (!hasTarget) {
    throw new Error("remove requires --all, --path, or --prefix");
  }

  const { results } = agentUntrustDir({
    homeDir: parsed.homeDir,
    all: parsed.all,
    ...(parsed.agent === undefined ? {} : { agent: parsed.agent }),
    ...(parsed.path === undefined ? {} : { path: parsed.path }),
    ...(parsed.pathPrefix === undefined ? {} : { pathPrefix: parsed.pathPrefix }),
    ...(parsed.trustMethod === undefined ? {} : { trustMethod: parsed.trustMethod }),
  });
  console.log(formatAgentTrustActionResults(results, { homeDir: parsed.homeDir, action: "remove" }));
}

const isDirectRun =
  process.argv[1] !== undefined &&
  (process.argv[1].endsWith("/cli.js") ||
    process.argv[1].endsWith("/cli.ts") ||
    process.argv[1].endsWith("agent-trust.js"));

if (isDirectRun) {
  try {
    main(process.argv.slice(2));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`${message}\n`);
    process.exitCode = error instanceof CliExitError ? error.exitCode : 1;
  }
}
