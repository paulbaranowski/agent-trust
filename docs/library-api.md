# Library API

Import from the package root:

```ts
import {
  agentTrustDir,
  agentUntrustDir,
  listAgentTrustedDirs,
  pruneAgentTrustedDirs,
  // …
} from "@paulbaranowski/agent-trust";
```

All store I/O for `agentTrustDir` returns an `AgentTrustDirResult` instead of throwing.
`agentUntrustDir` throws only for programmer misuse (no delete target). Path deletes that
fail I/O are reported per entry in `results`.

---

## Core mutations

### `agentTrustDir(input): AgentTrustDirResult`

Records trust for a directory so the agent skips its first-run trust dialog.

```ts
agentTrustDir({
  agent: "claude", // or "cursor" | "cursor-agent" | "codex"
  dirPath: "/path/to/dir",
  homeDir?: string, // defaults to os.homedir()
  trustMethod?: string, // default "agent-trust"; Cursor only persists this
});
```

| Result                                                                       | Meaning                        |
| ---------------------------------------------------------------------------- | ------------------------------ |
| `{ ok: true, status: "trusted", agent, dirPath }`                            | Trust was written              |
| `{ ok: true, status: "already-trusted", agent, dirPath }`                    | Already present; no write      |
| `{ ok: true, status: "skipped", reason: "unknown-agent", agentCommandName }` | Unknown agent; nothing written |
| `{ ok: false, status: "error", error, agent?, dirPath? }`                    | I/O or home resolution failed  |

`cursor-agent` is normalized to `cursor`. Claude and Codex accept `trustMethod` for API
uniformity but do not store it.

---

### `agentUntrustDir(input): AgentUntrustDirResult`

Deletes trust entries. You must pass one of `all`, `path`, or `pathPrefix`.

```ts
agentUntrustDir({
  all?: boolean,
  path?: string, // exact absolute directory
  pathPrefix?: string, // every path under this prefix
  agent?: "cursor" | "claude" | "codex",
  trustMethod?: string, // Cursor only: match marker trustMethod
  homeDir?: string,
});
// → { results: AgentTrustMutationResult[] }
```

Throws if none of `all` / `path` / `pathPrefix` is set.

Each `AgentTrustMutationResult` is `{ agent, dirPath, deleted, error? }`.

```ts
agentUntrustDir({ path: "/path/to/dir" });
agentUntrustDir({ pathPrefix: "/path/to/parent", agent: "claude" });
agentUntrustDir({
  all: true,
  agent: "cursor",
  trustMethod: "groundcrew-auto-trust",
});
```

---

### `listAgentTrustedDirs(input?): AgentTrustedDir[]`

Lists trusted directories from Cursor, Claude, and/or Codex stores.

```ts
listAgentTrustedDirs({
  agent?: "cursor" | "claude" | "codex",
  homeDir?: string,
  missingOnly?: boolean, // only paths that no longer exist on disk
});
```

Each `AgentTrustedDir` is `{ agent, dirPath, detail, store }`.

```ts
listAgentTrustedDirs();
listAgentTrustedDirs({ agent: "codex", missingOnly: true });
```

---

### `pruneAgentTrustedDirs(input?): PruneAgentTrustedDirsResult`

Removes trust entries whose `dirPath` no longer exists on disk.

```ts
pruneAgentTrustedDirs({
  agent?: "cursor" | "claude" | "codex",
  homeDir?: string,
});
// → { results: AgentTrustMutationResult[] }
```

```ts
pruneAgentTrustedDirs();
pruneAgentTrustedDirs({ agent: "claude" });
```

---

## Helpers

### `resolveDirPath(input): string`

Resolves a directory path for callers (and the CLI `--dir` flag). Blank or omitted
`dirPath` falls back to `cwd` (default `process.cwd()`).

```ts
resolveDirPath({}); // process.cwd()
resolveDirPath({ dirPath: "", cwd: "/tmp/ws" }); // "/tmp/ws"
resolveDirPath({ dirPath: "/tmp/child" }); // "/tmp/child"
```

---

### `normalizeAgent(agentCommandName): …`

Maps an agent command name to a canonical `AgentTrustAgent`, or reports unknown.

```ts
normalizeAgent("cursor-agent"); // { ok: true, agent: "cursor" }
normalizeAgent("claude"); // { ok: true, agent: "claude" }
normalizeAgent("gemini"); // { ok: false, agentCommandName: "gemini" }
```

---

### `isAgentTrustAgent(value): value is AgentTrustAgent`

Type guard for `"cursor" | "claude" | "codex"` (does **not** accept `"cursor-agent"`).

```ts
isAgentTrustAgent("cursor"); // true
isAgentTrustAgent("cursor-agent"); // false
```

---

### `isMissingAgentTrustedDir(entry): boolean`

`true` when `entry.dirPath` does not exist on disk.

```ts
const stale = listAgentTrustedDirs().filter(isMissingAgentTrustedDir);
```

---

## Formatting

### `shortenDirPath(dirPath, homeDir): string`

Replaces a home-directory prefix with `~`.

```ts
shortenDirPath("/Users/dev/proj", "/Users/dev"); // "~/proj"
```

---

### `formatAgentTrustedDirList(entries, options): string`

Human-readable list output (same shape as `agent-trust list`).

```ts
formatAgentTrustedDirList(listAgentTrustedDirs({ homeDir }), {
  homeDir,
  missingOnly?: boolean,
});
```

---

### `formatAgentTrustActionResults(results, options): string`

Human-readable output for remove/prune result arrays (same shape as the CLI).

```ts
const { results } = agentUntrustDir({ path: dir, homeDir });
formatAgentTrustActionResults(results, { homeDir, action: "remove" });
```

---

## Types and constants

| Export                                 | Description                                                     |
| -------------------------------------- | --------------------------------------------------------------- |
| `AgentTrustAgent`                      | `"cursor" \| "claude" \| "codex"`                               |
| `AgentTrustedDir`                      | Listed trust entry: `{ agent, dirPath, detail, store }`         |
| `AgentTrustDirResult`                  | Discriminated union from `agentTrustDir`                        |
| `AgentTrustMutationResult`             | Per-entry delete outcome: `{ agent, dirPath, deleted, error? }` |
| `AgentUntrustDirResult`                | `{ results: AgentTrustMutationResult[] }`                       |
| `PruneAgentTrustedDirsResult`          | `{ results: AgentTrustMutationResult[] }`                       |
| `AgentTrustDirInput`                   | Input to `agentTrustDir`                                        |
| `AgentUntrustDirInput`                 | Input to `agentUntrustDir`                                      |
| `ListAgentTrustedDirsInput`            | Input to `listAgentTrustedDirs`                                 |
| `PruneAgentTrustedDirsInput`           | Input to `pruneAgentTrustedDirs`                                |
| `FormatAgentTrustedDirListOptions`     | Options for list formatting                                     |
| `FormatAgentTrustActionResultsOptions` | Options for action formatting                                   |
| `DEFAULT_TRUST_METHOD`                 | `"agent-trust"` — default Cursor marker `trustMethod`           |

---

## On-disk stores

| Agent  | Store                                                                         |
| ------ | ----------------------------------------------------------------------------- |
| Cursor | `~/.cursor/projects/<slug>/.workspace-trusted` (JSON; includes `trustMethod`) |
| Claude | `~/.claude.json` → `projects.<absPath>.hasTrustDialogAccepted`                |
| Codex  | `~/.codex/config.toml` → `[projects."<absPath>"]` + `trust_level = "trusted"` |

The public API field is always `dirPath`. Cursor’s on-disk marker still uses the key
`workspacePath` for compatibility with existing markers.
