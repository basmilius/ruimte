import i18next from 'i18next';
import { useTranslation } from 'react-i18next';
import type { AgentKind, ModelInfo, ProviderInfo, RuntimeMode } from '@ruimte/contracts';
import {
    forgetChatSelection,
    rememberChatPreferences,
    rememberChatSelection,
    selectionFor,
    useChatPreferences,
    type ChatPreferences
} from '@/chat/preferences';
import { RUNTIME_MODES, runtimeModeHint, runtimeModeLabel } from '@/chat/runtime-modes';
import { canKeepAwake } from '@/desktop/bridge';
import { DeleteAnyViewSection } from '@/shell/settings/DeleteAnyViewSection';
import { SettingsRow } from '@/shell/settings/SettingsRow';
import { SettingsSection } from '@/shell/settings/SettingsSection';
import { Skeleton, Toggle } from '@/shell/settings/controls';
import { Pill } from '@/ui/Pill';
import { useProviders } from '@/state/providers';
import { useSettings } from '@/state/settings';
import { Select, type SelectItem } from '@/ui/Select';

const PROVIDER_DEFAULT = '';

/* Both mode rows offer the same choices, and each one explains itself in the popup. Built while the
   pane draws, so the words are the ones the interface is in right now. */
const runtimeModeItems = (): SelectItem<RuntimeMode>[] =>
    RUNTIME_MODES.map((mode) => ({ value: mode, label: runtimeModeLabel(mode), description: runtimeModeHint(mode) }));

/* What a provider offers, in one sentence: where it can be opened and whether its hooks report status. */
const providerAbilities = (provider: ProviderInfo): string => {
    const where = provider.capabilities.chat ? i18next.t('settings:agents.providers.chatAndTerminal') : i18next.t('settings:agents.providers.terminalOnly');
    const status = provider.capabilities.hooks ? i18next.t('settings:agents.providers.reportsStatus') : i18next.t('settings:agents.providers.noStatus');
    return `${where} ${status}`;
};

/* One row per knob the chosen model exposes; the composer's option picker shows the same descriptors. */
function ModelOptionRows({ provider, model, options }: { provider: AgentKind; model: ModelInfo; options: Record<string, string | boolean> }) {
    const setOption = (id: string, value: string | boolean): void => {
        rememberChatSelection(provider, { model: model.slug, options: { ...options, [id]: value } });
    };
    return (
        <>
            {model.options.map((option) =>
                option.type === 'select' ? (
                    <SettingsRow
                        key={option.id}
                        label={option.label}
                        control={
                            <Select
                                value={String(options[option.id] ?? option.defaultChoice)}
                                label={option.label}
                                align="end"
                                items={option.choices.map((choice) => ({ value: choice.id, label: choice.label, description: choice.description }))}
                                onValueChange={(value) => setOption(option.id, value)}
                            />
                        }
                    />
                ) : (
                    <SettingsRow
                        key={option.id}
                        label={option.label}
                        control={<Toggle checked={options[option.id] === true} label={option.label} onChange={(checked) => setOption(option.id, checked)} />}
                    />
                )
            )}
        </>
    );
}

/* The remembered model of one CLI, with the knobs of that model under it. */
function ProviderModelRows({ provider, preferences }: { provider: ProviderInfo; preferences: ChatPreferences }) {
    const { t } = useTranslation('settings');
    const selection = selectionFor(preferences, provider.kind);
    const model = provider.models.find((entry) => entry.slug === selection?.model);
    return (
        <>
            <SettingsRow
                label={provider.name}
                description={model ? undefined : t('agents.defaults.usesCliDefault')}
                control={
                    <Select
                        value={model?.slug ?? PROVIDER_DEFAULT}
                        label={t('agents.defaults.modelFor', { provider: provider.name })}
                        align="end"
                        items={[
                            { value: PROVIDER_DEFAULT, label: t('agents.defaults.providerDefault') },
                            ...provider.models.map((entry) => ({
                                value: entry.slug,
                                label: entry.legacy ? t('agents.defaults.legacyModel', { name: entry.name }) : entry.name
                            }))
                        ]}
                        onValueChange={(value) =>
                            value === PROVIDER_DEFAULT
                                ? forgetChatSelection(provider.kind)
                                : rememberChatSelection(provider.kind, { model: value, options: {} })
                        }
                    />
                }
            />
            {model && <ModelOptionRows provider={provider.kind} model={model} options={selection?.options ?? {}} />}
        </>
    );
}

export function AgentsPane() {
    const { t } = useTranslation('settings');
    const providers = useProviders((s) => s.providers);
    const loaded = useProviders((s) => s.loaded);
    const preferences = useChatPreferences();
    const agentsShowViews = useSettings((s) => s.agentsShowViews);
    const agentsApprovals = useSettings((s) => s.agentsApprovals);
    const agentsKeepAwake = useSettings((s) => s.agentsKeepAwake);
    const agentsTurnNotify = useSettings((s) => s.agentsTurnNotify);
    const agentsTurnSound = useSettings((s) => s.agentsTurnSound);
    const chatStreaming = useSettings((s) => s.chatStreaming);
    const update = useSettings((s) => s.update);
    const withModels = providers.filter((provider) => provider.models.length > 0);

    return (
        <>
            <SettingsSection title={t('agents.defaults.title')} description={t('agents.defaults.description')}>
                {withModels.length === 0 &&
                    (loaded ? (
                        <SettingsRow muted label={t('agents.defaults.noChatCli')} />
                    ) : (
                        <SettingsRow label={<Skeleton className="w-32" />} control={<Skeleton className="w-24" />} />
                    ))}
                {withModels.map((provider) => (
                    <ProviderModelRows key={provider.kind} provider={provider} preferences={preferences} />
                ))}
                <SettingsRow
                    label={t('agents.defaults.permissions')}
                    control={
                        <Select
                            value={preferences.runtimeMode}
                            label={t('agents.defaults.permissions')}
                            align="end"
                            items={runtimeModeItems()}
                            onValueChange={(value) => rememberChatPreferences({ runtimeMode: value })}
                        />
                    }
                />
                <SettingsRow
                    label={t('agents.defaults.terminalMode')}
                    control={
                        <Select
                            value={preferences.terminalRuntimeMode}
                            label={t('agents.defaults.terminalMode')}
                            align="end"
                            items={runtimeModeItems()}
                            onValueChange={(value) => rememberChatPreferences({ terminalRuntimeMode: value })}
                        />
                    }
                />
            </SettingsSection>
            <SettingsSection title={t('agents.here.title')} description={t('agents.here.description')}>
                <SettingsRow
                    label={t('agents.here.approvals.label')}
                    description={t('agents.here.approvals.description')}
                    control={
                        <Toggle
                            checked={agentsApprovals}
                            onChange={(checked) => update({ agentsApprovals: checked })}
                            label={t('agents.here.approvals.label')}
                        />
                    }
                />
                <SettingsRow
                    label={t('agents.here.showViews.label')}
                    description={t('agents.here.showViews.description')}
                    control={
                        <Toggle
                            checked={agentsShowViews}
                            onChange={(checked) => update({ agentsShowViews: checked })}
                            label={t('agents.here.showViews.label')}
                        />
                    }
                />
            </SettingsSection>
            <DeleteAnyViewSection />
            <SettingsSection title={t('agents.working.title')} description={t('agents.working.description')}>
                <SettingsRow
                    label={t('agents.working.turnNotify.label')}
                    description={t('agents.working.turnNotify.description')}
                    control={
                        <Toggle
                            checked={agentsTurnNotify}
                            onChange={(checked) => update({ agentsTurnNotify: checked })}
                            label={t('agents.working.turnNotify.label')}
                        />
                    }
                />
                {/* Not hidden with the switch above it any more: a question and a permission notify
                    whatever that one says, so this is the only answer to "may this make noise". */}
                <SettingsRow
                    label={t('agents.working.sound.label')}
                    description={t('agents.working.sound.description')}
                    control={
                        <Toggle
                            checked={agentsTurnSound}
                            onChange={(checked) => update({ agentsTurnSound: checked })}
                            label={t('agents.working.sound.label')}
                        />
                    }
                />
                {/* A browser cannot keep anything awake, so it is told nothing about a switch it has no way to honor. */}
                {canKeepAwake() && (
                    <SettingsRow
                        label={t('agents.working.keepAwake.label')}
                        description={t('agents.working.keepAwake.description')}
                        control={
                            <Toggle
                                checked={agentsKeepAwake}
                                onChange={(checked) => update({ agentsKeepAwake: checked })}
                                label={t('agents.working.keepAwake.toggle')}
                            />
                        }
                    />
                )}
            </SettingsSection>
            <SettingsSection title={t('agents.chats.title')}>
                <SettingsRow
                    label={t('agents.chats.streaming.label')}
                    control={
                        <Select
                            value={chatStreaming}
                            label={t('agents.chats.streaming.label')}
                            align="end"
                            items={[
                                { value: 'words', label: t('agents.chats.streaming.words.label'), description: t('agents.chats.streaming.words.description') },
                                {
                                    value: 'blocks',
                                    label: t('agents.chats.streaming.blocks.label'),
                                    description: t('agents.chats.streaming.blocks.description')
                                },
                                { value: 'whole', label: t('agents.chats.streaming.whole.label'), description: t('agents.chats.streaming.whole.description') }
                            ]}
                            onValueChange={(value) => update({ chatStreaming: value })}
                        />
                    }
                />
            </SettingsSection>
            <SettingsSection title={t('agents.providers.title')} description={t('agents.providers.description')}>
                {providers.length === 0 &&
                    (loaded ? (
                        <SettingsRow muted label={t('agents.providers.none')} />
                    ) : (
                        <>
                            <SettingsRow label={<Skeleton className="w-28" />} control={<Skeleton className="w-16" />} />
                            <SettingsRow label={<Skeleton className="w-36" />} control={<Skeleton className="w-16" />} />
                        </>
                    ))}
                {providers.map((provider) => (
                    <SettingsRow
                        key={provider.kind}
                        label={provider.name}
                        description={
                            provider.installed
                                ? `${provider.version ? `${t('agents.providers.version', { version: provider.version })} ` : ''}${providerAbilities(provider)}`
                                : undefined
                        }
                        control={
                            provider.installed ? (
                                <Pill shape="tag" tone="idle">
                                    {t('agents.providers.installed')}
                                </Pill>
                            ) : (
                                <Pill shape="tag" tone="muted">
                                    {t('agents.providers.missing')}
                                </Pill>
                            )
                        }
                    />
                ))}
            </SettingsSection>
        </>
    );
}
