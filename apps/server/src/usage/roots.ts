import { homedir } from 'node:os';
import { join } from 'node:path';
import type { UsageProvider } from '@ruimte/contracts';

export interface UsageRootPath {
    provider: UsageProvider;
    path: string;
    /* The accounts whose CLI writes here, by id, the default one under its kind; absent is the default account alone. */
    accounts?: string[];
}

/* Where in its config folder each CLI leaves its transcripts. */
const TRANSCRIPTS: Record<UsageProvider, string> = { claude: 'projects', codex: 'sessions' };

/* Where each CLI leaves its transcripts. The same environment variables the hooks installer reads,
   so the scanner and the installer never disagree about where a CLI keeps its things. */
export const usageRoots = (env: Record<string, string | undefined> = process.env): UsageRootPath[] => {
    const home = env.HOME ?? homedir();
    return [
        { provider: 'claude', path: join(env.CLAUDE_CONFIG_DIR ?? join(home, '.claude'), TRANSCRIPTS.claude) },
        { provider: 'codex', path: join(env.CODEX_HOME ?? join(home, '.codex'), TRANSCRIPTS.codex) }
    ];
};

/* The transcripts of every account, once per folder: Codex accounts over one home share its sessions. */
export const accountRoots = (folders: ReadonlyArray<{ id: string; kind: UsageProvider; folder: string }>): UsageRootPath[] => {
    const roots = new Map<string, UsageRootPath & { accounts: string[] }>();
    for (const { id, kind, folder } of folders) {
        const path = join(folder, TRANSCRIPTS[kind]);
        const key = `${kind}\0${path}`;
        const root = roots.get(key);
        if (root === undefined) {
            roots.set(key, { provider: kind, path, accounts: [id] });
        } else {
            root.accounts.push(id);
        }
    }
    return [...roots.values()];
};
