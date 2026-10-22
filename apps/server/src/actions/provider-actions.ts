import { evenPace, registryAgentMatches, type UsageLimitsProvider, type UsageLimitsSnapshot } from '@ruimte/contracts';
import type { ActionHandlers, ActionOutput } from '@ruimte/actions';
import { VerbRefusal, type NodeAccount, type ProviderInstallHost } from '../canvas/verb.ts';
import type { ServerActionContext } from './context.ts';

function installsOf(context: ServerActionContext): ProviderInstallHost {
    if (!context.host.providerInstalls) {
        throw new VerbRefusal('no-providers', 'This machine keeps no agent CLIs');
    }
    return context.host.providerInstalls;
}

/* The entry of an account; the default account of a CLI is under the CLI's kind, and so is an entry from before accounts. */
export function limitsOfAccount(snapshot: UsageLimitsSnapshot, account: NodeAccount): UsageLimitsProvider | null {
    const id = account.account ?? account.kind;
    return snapshot.providers.find((entry) => entry.kind === account.kind && (entry.account?.id ?? entry.kind) === id) ?? null;
}

function iso(at: number | null): string | null {
    return at === null || at <= 0 ? null : new Date(at).toISOString();
}

export function planLimitsOf(entry: UsageLimitsProvider, now: number): ActionOutput<'provider.limits'> {
    return {
        provider: entry.kind,
        account: entry.account?.label ?? null,
        plan: entry.plan,
        checkedAt: iso(entry.checkedAt),
        unavailable: entry.unavailable === null ? null : (entry.unavailable.message ?? entry.unavailable.reason),
        windows: entry.windows.map((window) => {
            const pace = evenPace(window, now);
            return {
                label: window.label,
                kind: window.kind,
                usedPercent: Math.round(window.used * 100),
                resetsAt: iso(window.resetsAt),
                evenPacePercent: pace?.percent ?? null,
                pace: pace?.standing ?? null
            };
        })
    };
}

export const providerActions: ActionHandlers<ServerActionContext> = {
    'provider.catalog': async ({ search, refresh }, { context }) => {
        const catalog = await installsOf(context).catalog(refresh === true);
        return { output: search == null ? catalog : { ...catalog, agents: catalog.agents.filter((agent) => registryAgentMatches(agent, search)) } };
    },
    'provider.versions': async ({ refresh }, { context }) => ({
        output: { versions: await installsOf(context).versions(refresh === true) }
    }),
    // Only the caller's own account: the numbers come from the CLIs as they last reported them, and nothing asks a provider again.
    'provider.limits': (_input, { actor, context }) => {
        const limits = context.host.planLimits;
        if (!limits) {
            throw new VerbRefusal('no-limits', 'This machine reads no plan windows');
        }
        const account = context.host.starts.accountOf?.(actor.id) ?? null;
        if (account === null) {
            throw new VerbRefusal('no-agent', 'You run no agent CLI this machine knows, so there is no plan to read');
        }
        const entry = limitsOfAccount(limits.snapshot(), account);
        if (entry === null) {
            throw new VerbRefusal(
                'no-limits',
                account.account === undefined
                    ? `This machine reads no plan windows for ${account.kind}`
                    : `This machine reads no plan windows for the ${account.kind} account you run on: it is off or signed out`
            );
        }
        return { output: planLimitsOf(entry, limits.now()) };
    }
};
