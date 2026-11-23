import type { ChatProvider } from '@adecore/agents/providers';
import type { AgentKind, ProviderInfo } from '@ruimte/contracts';
import { bestEffort } from '../best-effort.ts';

type Env = Record<string, string | undefined>;

/* How old the models an agent reported may be before the machine asks again. Each ask may leave an empty session in the agent's history. */
export const MODEL_REFRESH_MAX_AGE_MS = 24 * 60 * 60 * 1000;

interface RefreshableProviders {
    list(): Promise<ProviderInfo[]>;
    get(kind: AgentKind): ChatProvider;
    enabled(kind: AgentKind): boolean;
}

interface DefaultAccounts {
    envFor(kind: AgentKind, id: undefined, base: Env): Env;
}

/*
 * Asks every installed agent whose models change on the vendor's side for them again once its last report is a day old,
 * in its default account's environment. Run when the daemon starts and when a person comes back (`provider.detect`), never on a clock.
 */
export async function refreshAgentModels(providers: RefreshableProviders, accounts: DefaultAccounts, base: Env): Promise<void> {
    const installed = (await providers.list()).filter((info) => info.installed && providers.enabled(info.kind));

    await Promise.all(
        installed.map((info) => {
            const provider = providers.get(info.kind);

            // An account check with a login command opens the same session, so it keeps those models recent by itself.
            if (provider.refreshModels === undefined || (provider.home?.loginCommand !== undefined && provider.askAccount !== undefined)) {
                return Promise.resolve();
            }

            const refresh = async (): Promise<void> => {
                await provider.refreshModels?.(provider.command, accounts.envFor(info.kind, undefined, base), { maxAgeMs: MODEL_REFRESH_MAX_AGE_MS });
            };

            return bestEffort(`Reading the models of ${provider.name}`, refresh());
        })
    );
}
