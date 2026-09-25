import type { AgentKind, ProviderAccountMap, ProviderInfo } from '@ruimte/contracts';
import { providerFor } from '../registry.ts';
import { ProviderAccountsService } from './service.ts';

/*
 * The accounts of a machine as a test wants them: saved in `providers.json` under `ruimteHome`, with
 * only the folders in `folders` on disk, and every CLI signed in without being asked.
 */
export const testAccounts = async (options: {
    ruimteHome: string;
    env: Record<string, string | undefined>;
    accounts: ProviderAccountMap;
    // The folders that exist; a test takes one away to see what a missing folder does.
    folders: Set<string>;
}): Promise<ProviderAccountsService> => {
    const service = new ProviderAccountsService({
        ruimteHome: options.ruimteHome,
        providers: {
            list: async () => (['claude', 'codex'] as AgentKind[]).map((kind) => ({ kind, installed: true }) as ProviderInfo),
            get: (kind) => providerFor(kind)
        },
        env: options.env,
        ask: async () => ({ signedIn: true, email: null, plan: null, organization: null }),
        folderExists: (path) => options.folders.has(path),
        prepareShadow: async () => ({ linked: [], unshared: [], sharedLogin: false })
    });
    await service.load();
    await service.save(options.accounts);
    return service;
};
