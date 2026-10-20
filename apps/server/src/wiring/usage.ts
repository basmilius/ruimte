import { limitAccountsOf, usageAccountsOf, usageRootsOf, UsageMonitor, UsageService } from '@adecore/agents/usage';
import type { ServerConfig } from '../config.ts';
import type { ProjectStore } from '../projects/project-store.ts';
import { RUIMTE_CODEX_CLIENT } from '../providers/codex-provider.ts';
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
        // The calls of a subscription API have no transcript of a CLI's, so the daemon keeps a log of them that the scan reads.
        roots: () => [
            ...usageRootsOf(providers.accounts),
            { provider: 'nanogpt', path: providers.nanogpt.usageDirectory },
            { provider: 'anthropic-claude-api', path: providers.claudeApi.usageDirectory }
        ],
        sessionAccounts: () =>
            sessionAccountsOf(
                chats.list(),
                sessions.list().map(({ sessionId }) => ({ agent: sessions.get(sessionId)?.agent ?? null, launch: sessions.get(sessionId)?.launch ?? null }))
            ),
        accounts: () => usageAccountsOf(providers.accounts, providers.nameOfCli)
    });
    const limits = new UsageMonitor({
        providers: providers.providers,
        accounts: limitAccountsOf(providers.accounts, providers.nameOfCli, process.env),
        client: RUIMTE_CODEX_CLIENT,
        plans: { nanogpt: () => providers.nanogpt.readPlan() }
    });
    providers.accounts.listen(() => limits.accountsChanged());
    providers.nanogpt.onCall(
        followPlan(() => providers.nanogpt.readPlan(), { apply: ({ plan, windows }) => limits.applyLive({ kind: 'nanogpt', plan, windows }) })
    );
    return { usage, limits };
}
