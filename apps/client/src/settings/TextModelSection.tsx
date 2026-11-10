import { ChatScopeContext } from '@adecore/agents-react';
import { useProviderAccounts, useProviders } from '@adecore/agents-react/state';
import { ErrorBoundary, Segmented } from '@adecore/ui';
import { SettingsRow } from '@adecore/ui/settings';
import { EDITOR_ASSIST_PROVIDERS, type ProviderInfo, type TextModelChoice } from '@ruimte/contracts';
import { useTranslation } from 'react-i18next';
import { InlineAgentPicker } from '@/editor-ai/InlineAgentPicker';
import { useMachineSetting } from '@/machine-ui/machine-setting';
import { usePickedMachine } from '@/machines/picked-machine';
import { SettingsSection } from '@/machines/SettingsSection';
import { availableAgents } from '@/state/agent-availability';
import type { Endpoint } from '@/state/endpoints';
import { useServers } from '@/state/server';
import { useEndpointConnection } from '@/transport/status';
import { chatScopeOf } from '@/workspace/chat-scope';

/* Which model writes the short texts of the machine picked in the section's tag: new chat titles, commit messages and conflict proposals. */
export function TextModelSection() {
    const { t } = useTranslation('settings');
    const endpoint = usePickedMachine();

    if (endpoint === null) {
        return null;
    }

    return (
        <SettingsSection title={t('agents.textModel.title')} scope="machine" machine="picked">
            <ErrorBoundary key={endpoint.id} label={t('agents.textModel.failed')}>
                <ChatScopeContext.Provider value={chatScopeOf(endpoint.id)}>
                    <TextModelRow endpoint={endpoint} />
                </ChatScopeContext.Provider>
            </ErrorBoundary>
        </SettingsSection>
    );
}

/* The pick as words, for when the picker would show another CLI or cannot be used: the CLI's name and the model it names. */
function pickName(providers: readonly ProviderInfo[], choice: TextModelChoice): string {
    const owner = providers.find((provider) => provider.kind === choice.provider);
    const model = owner?.models.find((entry) => entry.slug === choice.model)?.name ?? choice.model;

    return [owner?.name ?? choice.provider, model].filter((part) => part !== null).join(' · ');
}

function TextModelRow({ endpoint }: { endpoint: Endpoint }) {
    const { t } = useTranslation('settings');
    const info = useServers((state) => state.byEndpoint[endpoint.id]);
    const providers = useProviders((state) => state.providers);
    const loaded = useProviders((state) => state.loaded);
    const accounts = useProviderAccounts((state) => state.accounts);
    const connection = useEndpointConnection(endpoint.id);
    const { busy, save } = useMachineSetting(endpoint);
    const choice = info?.textModel ?? null;
    const supported = info?.textModel !== undefined;
    const connected = connection.status === 'open';
    const offered = availableAgents(providers, 'terminal').filter((provider) => EDITOR_ASSIST_PROVIDERS.some((kind) => kind === provider.kind));
    const first = EDITOR_ASSIST_PROVIDERS.find((kind) => offered.some((provider) => provider.kind === kind));
    const disabled = busy || !connected || !supported || !loaded;
    const unavailable =
        choice !== null &&
        loaded &&
        (!offered.some((provider) => provider.kind === choice.provider) ||
            (choice.account !== undefined &&
                accounts !== null &&
                !Object.entries(accounts.accounts).some(
                    ([id, account]) => id === choice.account && account.kind === choice.provider && account.enabled !== false
                )));
    const description = !connected
        ? t('machine.notAnswering')
        : info === undefined || !loaded
          ? t('agents.textModel.loading')
          : !supported
            ? t('agents.textModel.update')
            : unavailable
              ? t('agents.textModel.unavailable')
              : t('agents.textModel.description');

    const change = (next: TextModelChoice | null): void => {
        void save({ textModel: next });
    };

    return (
        <SettingsRow
            searchId="agents.textModel"
            label={t('agents.textModel.label')}
            description={description}
            control={
                <div className="flex flex-wrap items-center justify-end gap-1.5">
                    <Segmented
                        value={choice === null ? 'automatic' : 'custom'}
                        options={[
                            { id: 'automatic', label: t('agents.textModel.automatic') },
                            { id: 'custom', label: t('agents.textModel.choose'), disabled: first === undefined && choice === null }
                        ]}
                        label={t('agents.textModel.label')}
                        disabled={disabled}
                        onValueChange={(mode) => {
                            if (mode === 'automatic') {
                                change(null);
                            } else if (first !== undefined) {
                                change({ provider: first, model: null });
                            }
                        }}
                    />
                    {choice !== null &&
                        (disabled || !offered.some((provider) => provider.kind === choice.provider) ? (
                            <span className="text-xs text-text-muted">{pickName(providers, choice)}</span>
                        ) : (
                            <InlineAgentPicker
                                agent={choice}
                                kinds={EDITOR_ASSIST_PROVIDERS}
                                capability="terminal"
                                footer={t('agents.textModel.footer')}
                                onChange={(agent) =>
                                    change({ provider: agent.provider, model: agent.model, ...(agent.account === undefined ? {} : { account: agent.account }) })
                                }
                            />
                        ))}
                </div>
            }
        />
    );
}
