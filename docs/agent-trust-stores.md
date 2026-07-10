# Agent trust-dir markings

How Cursor, Claude, and Codex record “this directory is trusted,” and how
`agent-trust` reads and writes those markings.

Agents use different on-disk formats. The public API always exposes a resolved
absolute `dirPath`; only the store layout differs.

All writes go through an atomic temp-file + rename (`mode 0o600`).

---

## Cursor

**Store:** `~/.cursor/projects/<slug>/.workspace-trusted` (JSON file per project)

### Path → slug

Cursor does not key by absolute path. It derives a **project slug** from the
workspace path (realpath when the path exists):

1. Strip leading `/` or `\`
2. Replace runs of unsafe characters (`\ / : * ? " < > |`) with `-`

Example: `/Users/dev/repo/worktree` → `Users-dev-repo-worktree`

Marker path:

```text
~/.cursor/projects/Users-dev-repo-worktree/.workspace-trusted
```

### Marker contents

```json
{
  "trustedAt": "2026-07-10T13:00:00.000Z",
  "workspacePath": "/Users/dev/repo/worktree",
  "trustMethod": "agent-trust"
}
```

| Field           | Role                                                                        |
| --------------- | --------------------------------------------------------------------------- |
| `workspacePath` | Absolute directory that was trusted (on-disk key name; API uses `dirPath`)  |
| `trustMethod`   | Who wrote the marker (default `"agent-trust"`). Used when filtering removes |
| `trustedAt`     | ISO timestamp of the write                                                  |

Cursor is the **only** agent that persists `trustMethod`. Claude and Codex accept
the parameter for API uniformity but ignore it on disk.

### Trust / already-trusted

- If the marker is missing → write a new marker (`status: "trusted"`).
- If the marker exists and `workspacePath` is missing or resolves to the same
  path → no write (`status: "already-trusted"`).
- If the marker exists but records a **different** path under the same slug
  (slug collision) → rewrite the marker for the new path.

### List

Scans `~/.cursor/projects/*/`. For each `.workspace-trusted`:

- Prefer `workspacePath` from the JSON when present
- Otherwise reconstruct a path from the slug (`-` → `/`, prefixed with `/`)
- `detail` is the marker’s `trustMethod`, or `"trusted"` / `"trusted (unparseable marker)"`

### Untrust

Deletes the `.workspace-trusted` file at `entry.store`. Optional
`trustMethod` filter keeps only markers whose stored method matches (so you can
clear auto-seeded entries without touching manual ones).

---

## Claude

**Store:** `~/.claude.json` → `projects.<absPath>`

### Project key

Projects are keyed by absolute path under the top-level `projects` object.
Lookup prefers an exact key match, then any key that resolves to the same path
(via realpath when present).

### Trust fields

When trusting, Claude sets (or merges into) the project entry:

```json
{
  "projects": {
    "/Users/dev/repo/worktree": {
      "hasTrustDialogAccepted": true,
      "hasCompletedProjectOnboarding": true
    }
  }
}
```

| Field                           | Role                                        |
| ------------------------------- | ------------------------------------------- |
| `hasTrustDialogAccepted`        | Trust gate Claude checks at project open    |
| `hasCompletedProjectOnboarding` | Also set so first-run onboarding is skipped |

Existing keys on the project entry are preserved; only these two flags are
forced on. `trustMethod` is **not** stored.

### Trust / already-trusted

- If `hasTrustDialogAccepted === true` → `status: "already-trusted"`
- Otherwise merge the flags and rewrite `~/.claude.json` → `status: "trusted"`

Corrupt JSON, a non-object root, or a non-object `projects` field returns
`{ ok: false, status: "error" }` and does **not** overwrite the file.

### List

Emits one entry per project where `hasTrustDialogAccepted === true`.

- `detail`: `"hasTrustDialogAccepted"`
- `store`: `~/.claude.json#projects`

### Untrust

Clears `hasTrustDialogAccepted` and `hasCompletedProjectOnboarding` from the
matching project entry. If nothing else remains on that entry, the project key
is removed entirely. Other project metadata is left intact.

---

## Codex

**Store:** `$CODEX_HOME/config.toml` (or `~/.codex/config.toml`) →
`[projects.<json-path>]`

Optional library `codexHome` overrides `CODEX_HOME` / the default.

### Project section

Codex records per-workspace trust as a TOML table whose header embeds the
absolute path via `JSON.stringify`:

```toml
[projects."/Users/dev/repo/worktree"]
trust_level = "trusted"
```

### Trust / already-trusted

- If the section already has `trust_level = "trusted"` → `status: "already-trusted"`
- If the section exists with a different / missing `trust_level` → set or replace
  it to `"trusted"`
- If the section is missing → append the header + `trust_level` line

A missing `config.toml` is treated as empty content (created on first trust).
`trustMethod` is **not** stored.

### List

Parses every `[projects."…"]` header. Only sections whose body has
`trust_level = "trusted"` are listed.

- `detail`: `"trust_level=trusted"`
- `store`: the resolved Codex config path (`$CODEX_HOME/config.toml`, or
  `codexHome`, else `~/.codex/config.toml`)

### Untrust

Removes the `trust_level` line from the matching section. If the section has no
remaining keys, the whole `[projects."…"]` block is deleted (extra blank lines
collapsed).

---

## Cross-agent behavior

| Concern                | Cursor                          | Claude                                 | Codex                                    |
| ---------------------- | ------------------------------- | -------------------------------------- | ---------------------------------------- |
| Store shape            | One JSON file per project slug  | Single JSON file, path-keyed           | Single TOML file, path-keyed             |
| Path identity          | Slug (+ `workspacePath` inside) | Absolute path key                      | Absolute path in table header            |
| Trust signal           | Marker file exists              | `hasTrustDialogAccepted: true`         | `trust_level = "trusted"`                |
| Persists `trustMethod` | Yes                             | No                                     | No                                       |
| Delete granularity     | Delete marker file              | Strip trust flags (drop empty project) | Strip `trust_level` (drop empty section) |

`listAgentTrustedDirs` / `agentUntrustDir` / `pruneAgentTrustedDirs` walk these
stores through the same adapters. Prune deletes entries whose `dirPath` no longer
exists on disk; it does not reinterpret agent-specific fields beyond that.
