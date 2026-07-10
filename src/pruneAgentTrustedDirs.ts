import { homedir } from "node:os";

import { resolveHomeDir } from "./agents/shared.ts";
import { collectTrustEntries } from "./listAgentTrustedDirs.ts";
import { deleteTrustEntrySafe } from "./agentUntrustDir.ts";
import type { AgentTrustAgent, PruneAgentTrustedDirsResult } from "./types.ts";

export interface PruneAgentTrustedDirsInput {
  homeDir?: string;
  agent?: AgentTrustAgent;
  /** Override Codex config directory (`CODEX_HOME` / `~/.codex`). */
  codexHome?: string;
  /** Test seam for `os.homedir()` failures. */
  readHome?: () => string;
}

/** Remove trust entries whose directory paths no longer exist on disk. */
export function pruneAgentTrustedDirs(
  input: PruneAgentTrustedDirsInput = {},
): PruneAgentTrustedDirsResult {
  const home = resolveHomeDir(input.homeDir, input.readHome ?? homedir);
  if (home === undefined) {
    return { results: [] };
  }

  const codexOptions =
    input.codexHome === undefined ? {} : { codexHome: input.codexHome };

  const staleEntries = collectTrustEntries({
    homeDir: home,
    missingOnly: true,
    ...(input.agent === undefined ? {} : { agent: input.agent }),
    ...codexOptions,
  });

  return {
    results: staleEntries.map((entry) => deleteTrustEntrySafe(home, entry, codexOptions)),
  };
}
