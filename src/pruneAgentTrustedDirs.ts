import { homedir } from "node:os";

import { resolveHomeDir } from "./agents/shared.ts";
import { collectTrustEntries } from "./listAgentTrustedDirs.ts";
import { deleteTrustEntrySafe } from "./agentUntrustDir.ts";
import type { AgentTrustAgent, PruneAgentTrustedDirsResult } from "./types.ts";

export interface PruneAgentTrustedDirsInput {
  homeDir?: string;
  agent?: AgentTrustAgent;
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

  const staleEntries = collectTrustEntries({
    homeDir: home,
    missingOnly: true,
    ...(input.agent === undefined ? {} : { agent: input.agent }),
  });

  return { results: staleEntries.map((entry) => deleteTrustEntrySafe(home, entry)) };
}
