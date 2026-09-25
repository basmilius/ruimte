import type { AgentKind, ProviderAccountMap, ProviderInfo } from '@ruimte/contracts';
import { providerFor } from '../registry.ts';
import { ProviderAccountsService } from './service.ts';
import { accountsPath, writeAccounts } from './store.ts';
import type { SecretStore } from './variables.ts';

/* A keychain in memory; `values` is what it holds, by key. */
export const memorySecrets = (values = new Map<string, string>()): SecretStore & { values: Map<string, string> } => ({
    values,
    read: async (key) => values.get(key) ?? null,
    write: async (key, value) => {
        values.set(key, value);
    },
    remove: async (key) => {
        values.delete(key);
    }
});

/*
 * The accounts of a machine as a test wants them: written to `providers.json` under `ruimteHome` as
 * they are, with only the folders in `folders` on disk, and every CLI signed in without being asked.
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
        prepareShadow: async () => ({ linked: [], unshared: [], sharedLogin: false }),
        secrets: memorySecrets()
    });
    // Written and not saved, so an account whose folder is already gone is there the way a person left it.
    await writeAccounts(accountsPath(options.ruimteHome), options.accounts);
    await service.load();
    return service;
};
