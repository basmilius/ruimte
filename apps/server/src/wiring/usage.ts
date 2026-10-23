import { limitAccountsOf, usageAccountsOf, usageRootsOf, UsageMonitor, UsageService, type LimitAccounts } from '@adecore/agents/usage';
import type { ServerConfig } from '../config.ts';
import type { ProjectStore } from '../projects/project-store.ts';
import { copilotUsageDirectory } from '../providers/acp-providers.ts';
import { RUIMTE_CODEX_CLIENT } from '../providers/codex-provider.ts';
import { readGrokPlan } from '../usage/grok-plan.ts';
import { followPlan } from '../usage/nanogpt-live.ts';
import { sessionAccountsOf } from '../usage/session-accounts.ts';
import type { AgentsBundle } from './agents.ts';
import type { ProvidersBundle } from './providers.ts';

/* What the agents of this machine spent, and what their plans have left. */
export interface UsageBundle {
    usage: UsageService;
    limits: UsageMonitor;
}

export function wireUsage(config: ServerConfig, providers: ProvidersBundle, agents: AgentsBundle, projects: ProjectStore): UsageBundle {
    const { sessions, chats } = agents;
    const usage = new UsageService({
        home: config.home,
        allowPriceFetch: config.priceFetch,
        knownProjects: () => projects.known(),
        // A subscription API and Copilot leave no transcript the scan reads, so the daemon keeps a log of their turns.
        roots: () => [
            ...usageRootsOf(providers.accounts),
            { provider: 'nanogpt', path: providers.nanogpt.usageDirectory },
            { provider: 'copilot', path: copilotUsageDirectory(config.home) }
        ],
        sessionAccounts: () =>
            sessionAccountsOf(
                chats.list(),
                sessions.list().map(({ sessionId }) => ({ agent: sessions.get(sessionId)?.agent ?? null, launch: sessions.get(sessionId)?.launch ?? null }))
            ),
        accounts: () => usageAccountsOf(providers.accounts, providers.nameOfCli)
    });
    const limitAccounts = withoutNanoGptUntilKeyed(
        limitAccountsOf(providers.accounts, providers.nameOfCli, process.env),
        () => providers.nanogpt.apiKey !== ''
    );
    const limits = new UsageMonitor({
        providers: providers.providers,
        accounts: limitAccounts,
        client: RUIMTE_CODEX_CLIENT,
        plans: {
            nanogpt: () => providers.nanogpt.readPlan(),
            grok: async (account) => {
                const installed = (await providers.providers.list()).some((provider) => provider.kind === 'grok' && provider.installed);
                return installed ? readGrokPlan(limitAccounts.envFor('grok', account.id)) : { unavailable: { reason: 'not-installed', message: null } };
            }
        }
    });
    providers.accounts.listen(() => limits.accountsChanged());
    providers.nanogpt.onChange(() => {
        limits.accountsChanged();
        void limits.refresh(false);
    });
    providers.nanogpt.onCall(
        followPlan(() => providers.nanogpt.readPlan(), { apply: ({ plan, windows }) => limits.applyLive({ kind: 'nanogpt', plan, windows }) })
    );
    return { usage, limits };
}

/* NanoGPT has no CLI to install, so without a key it is a provider nobody set up and its plan is left out of the limits. */
export function withoutNanoGptUntilKeyed(accounts: LimitAccounts, keyed: () => boolean): LimitAccounts {
    return { ...accounts, list: () => accounts.list().filter((account) => account.kind !== 'nanogpt' || keyed()) };
}
