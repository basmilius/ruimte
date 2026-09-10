import { homedir } from 'node:os';
import { join } from 'node:path';
import type { UsageProvider } from '@ruimte/contracts';

export interface UsageRootPath {
    provider: UsageProvider;
    path: string;
}

/* Where each CLI leaves its transcripts. The same environment variables the hooks installer reads,
   so the scanner and the installer never disagree about where a CLI keeps its things. */
export const usageRoots = (env: Record<string, string | undefined> = process.env): UsageRootPath[] => {
    const home = env.HOME ?? homedir();
    return [
        { provider: 'claude', path: join(env.CLAUDE_CONFIG_DIR ?? join(home, '.claude'), 'projects') },
        { provider: 'codex', path: join(env.CODEX_HOME ?? join(home, '.codex'), 'sessions') }
    ];
};
