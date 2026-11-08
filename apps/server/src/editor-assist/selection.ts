import { CodedError } from '@adecore/agents';
import type { ChatProvider, ProviderAccountsService } from '@adecore/agents/providers';
import prices from '@adecore/agents/usage/prices-snapshot.json' with { type: 'json' };
import { EDITOR_ASSIST_PROVIDERS, type EditorAssistAgent, cheapestEditorModel } from '@ruimte/contracts';
import type { ProviderRegistry } from '../providers/registry.ts';

export interface AssistProviders {
    registry: Pick<ProviderRegistry, 'current' | 'get' | 'oneShotProvider'>;
    accounts: Pick<ProviderAccountsService, 'snapshot' | 'envFor'>;
}

export interface AssistSelection {
    provider: ChatProvider;
    model: string;
    account: string;
}

/*
 * The environment a one-shot CLI runs in under its account: the daemon's own without Ruimte's variables
 * and the marker of a Claude Code parent. Throws for an account this machine cannot start.
 */
export function assistEnvironment(
    accounts: AssistProviders['accounts'],
    selection: Pick<AssistSelection, 'provider' | 'account'>,
    base: Record<string, string | undefined>
): Record<string, string> {
    const inherited = accounts.envFor(selection.provider.kind, selection.account, base);

    return Object.fromEntries(
        Object.entries(inherited).filter(
            (entry): entry is [string, string] => entry[1] !== undefined && !entry[0].startsWith('RUIMTE_') && entry[0] !== 'CLAUDECODE'
        )
    );
}

/* What a refusal says and where it sends a person, since other features pick a model the same way. */
export interface AssistWording {
    readonly chosenUnavailable: string;
    readonly noneAvailable: string;
}

const EDITOR_WORDING: AssistWording = {
    chosenUnavailable: 'The selected editor model is unavailable. Choose another model in Settings, Editor, AI.',
    noneAvailable: 'No configured editor model is available. Sign in to Claude, Codex, Grok or Antigravity, or choose a model in Settings, Editor, AI.'
};

/*
 * The CLI, model and account that answer. Without an agent, the cheapest model of the first usable
 * provider; with one, exactly that pick or a refusal, never another provider.
 */
export async function selectAssistAgent(
    { registry, accounts }: AssistProviders,
    agent?: EditorAssistAgent | null,
    wording: AssistWording = EDITOR_WORDING
): Promise<AssistSelection> {
    const installed = await registry.current();
    const snapshot = accounts.snapshot();
    const order = agent === undefined || agent === null ? EDITOR_ASSIST_PROVIDERS : [agent.provider];

    for (const kind of order) {
        if (!installed.some((provider) => provider.kind === kind && provider.installed)) {
            continue;
        }

        const available = Object.entries(snapshot.accounts).filter(
            ([id, account]) =>
                account.kind === kind &&
                account.enabled !== false &&
                !snapshot.statuses.some((status) => status.id === id && status.state !== 'ready' && status.state !== 'checking')
        );
        const account = agent === undefined || agent === null ? (available.find(([id]) => id === kind)?.[0] ?? available[0]?.[0]) : (agent.account ?? kind);

        if (account === undefined || !available.some(([id]) => id === account)) {
            continue;
        }

        const provider = await registry.oneShotProvider(kind);

        if (provider?.kind !== kind) {
            continue;
        }

        const model =
            agent?.model === undefined || agent.model === null
                ? cheapestEditorModel(provider.catalog.list(), prices)
                : provider.catalog.resolveModel(agent.model);

        if (model === null) {
            if (agent !== undefined && agent !== null) {
                throw new CodedError('unavailable', wording.chosenUnavailable);
            }

            continue;
        }

        return { provider, model, account };
    }

    throw new CodedError('unavailable', agent === undefined || agent === null ? wording.noneAvailable : wording.chosenUnavailable);
}
