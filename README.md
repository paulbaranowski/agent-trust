# @paulbaranowski/agent-trust

Library and CLI for managing Cursor, Claude, and Codex workspace trust stores.

Zero runtime dependencies. Requires Node `>=24`. MIT licensed.

## Install

```bash
npm i -g @paulbaranowski/agent-trust
```

Or add it as a library dependency:

```bash
npm i @paulbaranowski/agent-trust
```

## Library

`trust()` records workspace trust for an agent. It never throws on store I/O —
it returns a `TrustResult` discriminated union.

```ts
import { trust } from "@paulbaranowski/agent-trust";

const result = trust({
  agent: "cursor", // "cursor" | "cursor-agent" | "claude" | "codex"
  workspacePath: process.cwd(),
  // trustMethod defaults to "agent-trust"; Cursor markers record it.
  trustMethod: "groundcrew-auto-trust",
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

Other exports: `list`, `untrust`, `prune`, `isMissingAgentTrustEntry`,
`normalizeAgent`, `isAgentTrustAgent`, `resolveWorkspacePath`, the format
helpers (`formatTrustList`, `formatTrustActionResults`, `shortenTrustPath`), and
all types (`TrustResult`, `AgentTrustEntry`, `MutationEntryResult`,
`UntrustResult`, `PruneResult`, `DEFAULT_TRUST_METHOD`).

`untrust()` and `prune()` return `{ results: MutationEntryResult[] }`.

## CLI

| Command  | Description                                                         |
| -------- | ------------------------------------------------------------------- |
| `list`   | List workspace trust entries for Cursor, Claude, and Codex.         |
| `add`    | Record trust for a workspace (`--agent`, optional `--dir`).         |
| `remove` | Delete trust entries (`--all`, `--path`, or `--prefix`).            |
| `prune`  | Remove trust entries whose workspace paths no longer exist on disk. |

```
agent-trust list [--agent cursor|claude|codex] [--missing] [--home <dir>]
agent-trust add --agent <agent> [--dir <abs>] [--home <dir>] [--trust-method <value>]
agent-trust remove (--all | --path <abs> | --prefix <dir>)
  [--agent cursor|claude|codex] [--trust-method <value>] [--home <dir>]
agent-trust prune [--agent cursor|claude|codex] [--home <dir>]
```

`--trust-method` on `remove` filters Cursor markers to those recorded with the
matching trust method, e.g. to remove only auto-seeded markers:

```bash
agent-trust remove --all --agent cursor --trust-method groundcrew-auto-trust
```

## License

MIT
