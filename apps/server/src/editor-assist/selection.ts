import { CodedError } from '@adecore/agents';
import type { ChatProvider, ProviderAccountsService } from '@adecore/agents/providers';
import prices from '@adecore/agents/usage/prices-snapshot.json' with { type: 'json' };
import { EDITOR_ASSIST_PROVIDER_LIST, EDITOR_ASSIST_PROVIDERS, type EditorAssistAgent, cheapestEditorModel } from '@ruimte/contracts';
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

export async function selectAssistAgent({ registry, accounts }: AssistProviders, agent?: EditorAssistAgent | null): Promise<AssistSelection> {
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
                throw new CodedError('unavailable', 'The selected editor model is unavailable. Choose another model in Settings, Editor, AI.');
            }

            continue;
        }

        return { provider, model, account };
    }

    throw new CodedError(
        'unavailable',
        `No configured editor model is available. Sign in to ${EDITOR_ASSIST_PROVIDER_LIST}, or choose a model in Settings, Editor, AI.`
    );
}
