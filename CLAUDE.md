# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

`agent-trust` is a zero-runtime-dependency ESM library and CLI (Node `>=24`) that reads and writes the
directory trust stores of three coding agents: Cursor (`cursor` / `cursor-agent`), Claude (`claude`), and
Codex (`codex`). Trusting a directory pre-seeds the agent's on-disk state so it skips its first-run trust
dialog. The `bin/agent-trust.js` wrapper just imports `dist/cli.js`.

## Commands

```bash
npm test                       # vitest run (all *.test.ts under src/)
npx vitest run src/agents/codex.test.ts   # single test file
npx vitest run -t "already-trusted"       # single test by name
npx vitest                     # watch mode
npm run typecheck              # tsc --noEmit (strict, noUncheckedIndexedAccess)
npm run build                  # tsup -> dist/ (index.js + cli.js, .d.ts, sourcemaps)
npm run verify                 # typecheck + test + build; run this before declaring work done
```

There is no separate lint step; `typecheck` under `strict` is the type gate.

## Architecture

The public surface (see `src/index.ts`) is four operations, each a thin dispatcher in its own file that
fans out to a per-agent implementation:

- `agentTrustDir` (`src/agentTrustDir.ts`) -> `ensureCursorTrust` / `ensureClaudeTrust` / `ensureCodexTrust`
- `listAgentTrustedDirs` (`src/listAgentTrustedDirs.ts`) -> the `list*TrustEntries` readers
- `agentUntrustDir` (`src/agentUntrustDir.ts`) -> the `delete*TrustEntry` removers
- `pruneAgentTrustedDirs` (`src/pruneAgentTrustedDirs.ts`) -> removes entries whose directory is gone from disk

Each agent's on-disk knowledge lives entirely in its `src/agents/<agent>.ts` module. To add or change how an
agent stores trust, edit only that module plus the dispatchers. The three stores differ substantially:

- **Cursor** (`cursor.ts`): a `.workspace-trusted` JSON marker under `~/.cursor/projects/<slug>/`, where the
  slug is the realpath with separators/illegal chars replaced by `-`. Only Cursor persists `trustMethod`.
- **Claude** (`claude.ts`): flags `hasTrustDialogAccepted` / `hasCompletedProjectOnboarding` on a per-project
  entry inside `~/.claude.json` under `projects`.
- **Codex** (`codex.ts`): a `[projects.<json-path>]` table with `trust_level = "trusted"` in `config.toml`,
  under `CODEX_HOME` / `~/.codex`. Handles legacy header shapes and does string-level TOML editing (no TOML
  parser) to preserve the rest of the file.

`docs/agent-trust-stores.md` is the authoritative spec for these formats; keep it in sync when store logic
changes. `docs/library-api.md` documents every export.

## Conventions that matter

- **Never throw on store I/O.** Mutations return the `AgentTrustDirResult` discriminated union (`src/types.ts`):
  `ok:false` for real errors, `ok:true` with `status: "skipped"` for unknown agents. List/prune readers
  degrade to `[]` on permission/I/O failures rather than throwing. Preserve this contract in every agent module.
- **Path canonicalization is the identity key.** `canonicalizeWorkspacePath` (`src/agents/shared.ts`) resolves
  via `realpathSync.native` when the path exists, else `path.resolve`. All three stores are keyed by this
  canonical form, so symlinked / non-canonical inputs must match existing entries. Look-ups compare canonical
  paths, not raw strings.
- **Writes are atomic.** Use `writeFileAtomic` (temp file + `renameSync`, mode `0o600`) for anything touching a
  user's config; never write in place.
- `cursor-agent` normalizes to `cursor` (`src/normalize.ts`). Unknown agents are skipped, not errored.
- Tests are colocated (`*.test.ts` beside the source) and use vitest globals (no imports of `describe`/`it`).
  Imports use explicit `.ts` extensions (`allowImportingTsExtensions`).

## Releasing

Every PR that changes shipped or behavioral code must bump `package.json` version. Run
`npm version <patch|minor|major> --no-git-tag-version` as part of the change before opening the PR. The
`.github/workflows/version-bump.yml` check enforces this: it fails a PR whose version is not strictly greater
than the base branch's, unless the PR touches only exempt paths (`*.md`, `.github/**`, `*.test.ts`,
`.gitignore`, `LICENSE`). Bump proactively so the gate stays a backstop rather than the trigger.
