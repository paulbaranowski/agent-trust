# agent-trust

Library and CLI for managing Cursor, Claude, and Codex directory trust stores.

Zero runtime dependencies. Requires Node `>=24`. MIT licensed.

**Supported agents:** Cursor (`cursor` / `cursor-agent`), Claude (`claude`), Codex (`codex`).

## Install

```bash
npm i -g agent-trust
```

Or add it as a library dependency:

```bash
npm i agent-trust
```

## Library

`agentTrustDir()` records directory trust for an agent. It never throws on store
I/O — it returns an `AgentTrustDirResult` discriminated union.

```ts
import { agentTrustDir } from "agent-trust";

const result = agentTrustDir({
  agent: "cursor", // "cursor" | "cursor-agent" | "claude" | "codex"
  dirPath: process.cwd(),
  // trustMethod defaults to "agent-trust"; Cursor markers record it.
  trustMethod: "groundcrew-auto-trust",
  // Optional: override Codex config dir (else CODEX_HOME, else ~/.codex).
  // codexHome: "/custom/codex",
});

if (!result.ok) {
  console.error(result.error);
} else if (result.status === "skipped") {
  // unknown agent — nothing was written
}
```

- `agent`: `cursor-agent` is normalized to `cursor`. Unknown agents return
  `{ ok: true, status: "skipped", reason: "unknown-agent", agentCommandName }`.
- `trustMethod`: defaults to `"agent-trust"`. Only Cursor persists it in its
  marker; Claude and Codex accept the parameter for API uniformity but do not
  store it. Groundcrew callers should pass `"groundcrew-auto-trust"`.

Full reference for every export (mutations, helpers, formatters, and types):
**[Library API](docs/library-api.md)**.

How each agent records trust on disk (Cursor markers, Claude `~/.claude.json`,
Codex `config.toml`): **[Agent trust-dir markings](docs/agent-trust-stores.md)**.

## CLI

```
agent-trust list [PATH] [--agent cursor|claude|codex] [--missing] [--home <dir>]
agent-trust add --agent <agent> [--dir <abs>] [--home <dir>] [--trust-method <value>]
agent-trust remove (--all | --path <abs> | --prefix <dir>)
  [--agent cursor|claude|codex] [--trust-method <value>] [--home <dir>]
agent-trust prune [--agent cursor|claude|codex] [--home <dir>]
```

### `list`

Shows trusted directories recorded for Cursor, Claude, and Codex. Paths under
your home directory are shortened with `~`. Missing paths (directory gone from
disk) are marked. Use `--agent` to limit to one agent, or `--missing` to show
only stale entries. Pass an optional `PATH` (for example `.`) to show only
entries for that exact directory after path canonicalization.

```bash
agent-trust list
agent-trust list .
agent-trust list --agent claude
agent-trust list --missing
```

### `add`

Records trust for a directory so the agent skips its first-run trust dialog.
`--agent` is required (`cursor`, `claude`, or `codex`). `--dir` defaults to the
current working directory. Cursor markers store `--trust-method` (default
`agent-trust`); pass a custom value when you need to filter those markers later.

```bash
agent-trust add --agent claude --dir "$PWD"
agent-trust add --agent cursor --dir "$PWD" --trust-method groundcrew-auto-trust
agent-trust add --agent codex
```

### `remove`

Deletes trust entries. You must pass exactly one target style: `--all`,
`--path <abs>`, or `--prefix <dir>`. Optionally narrow with `--agent`. On
Cursor, `--trust-method` keeps only markers whose stored method matches (useful
for clearing auto-seeded entries without touching manual ones).

```bash
agent-trust remove --path "$HOME/worktrees/repo-team-1"
agent-trust remove --prefix "$HOME/worktrees" --agent claude
agent-trust remove --all --agent cursor --trust-method groundcrew-auto-trust
```

### `prune`

Removes trust entries whose directory path no longer exists on disk. Same as
`list --missing` followed by deleting those entries. Optionally limit with
`--agent`.

```bash
agent-trust prune
agent-trust prune --agent codex
```

## Path semantics and concurrency

- **Canonicalization:** Workspace paths are `realpath`'d when they exist (so
  symlink aliases and `/tmp` vs `/private/tmp` share one trust key). Missing
  paths fall back to `path.resolve`.
- **Cursor slug:** Project directory names under `~/.cursor/projects/` strip
  leading separators and replace unsafe characters (`\ / : * ? " < > |`) with
  `-` (Orca-compatible).
- **Codex:** Config lives under `CODEX_HOME` when set (or an explicit
  `codexHome` library option), otherwise `~/.codex`. Project table headers use
  `JSON.stringify` for escaping.
- **Claude:** Corrupt or non-object `~/.claude.json` (or an invalid `projects`
  field) returns an error result and is **not** overwritten.
- **Concurrency:** Shared JSON/TOML stores use read-merge-write. Concurrent
  `agentTrustDir()` calls from multiple processes can race. Cross-process
  locking (emdash in-process lock / whip `flock`) is out of scope for this
  release.

## License

MIT
