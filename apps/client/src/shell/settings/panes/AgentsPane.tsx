import type { AgentKind, ModelInfo, ProviderInfo, RuntimeMode } from '@ruimte/contracts';
import {
    forgetChatSelection,
    rememberChatPreferences,
    rememberChatSelection,
    selectionFor,
    useChatPreferences,
    type ChatPreferences
} from '@/chat/preferences';
import { RUNTIME_MODES } from '@/chat/runtime-modes';
import { SettingsRow } from '@/shell/settings/SettingsRow';
import { SettingsSection } from '@/shell/settings/SettingsSection';
import { Badge, Skeleton, Toggle } from '@/shell/settings/controls';
import { useProviders } from '@/state/providers';
import { Select, type SelectItem } from '@/ui/Select';

const PROVIDER_DEFAULT = '';

/* Both mode rows offer the same choices, and each one explains itself in the popup. */
const runtimeModeItems: SelectItem<RuntimeMode>[] = RUNTIME_MODES.map((mode) => ({ value: mode.id, label: mode.label, description: mode.hint }));

/* What a provider offers, in one sentence: where it can be opened and whether its hooks report status. */
const providerAbilities = (provider: ProviderInfo): string => {
    const where = provider.capabilities.chat ? 'Chat and terminal.' : 'Terminal only.';
    return `${where} ${provider.capabilities.hooks ? 'Reports status through its hooks.' : 'No status beyond the session itself.'}`;
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
    const selection = selectionFor(preferences, provider.kind);
    const model = provider.models.find((entry) => entry.slug === selection?.model);
    return (
        <>
            <SettingsRow
                label={provider.name}
                description={
                    model
                        ? `New chats and terminals on ${provider.name} start on ${model.name}${model.legacy ? ', a legacy model' : ''}.`
                        : "Provider default follows the CLI's own choice."
                }
                control={
                    <Select
                        value={model?.slug ?? PROVIDER_DEFAULT}
                        label={`Default model for ${provider.name}`}
                        align="end"
                        items={[
                            { value: PROVIDER_DEFAULT, label: 'Provider default' },
                            ...provider.models.map((entry) => ({ value: entry.slug, label: `${entry.name}${entry.legacy ? ' (legacy)' : ''}` }))
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
    const providers = useProviders((s) => s.providers);
    const loaded = useProviders((s) => s.loaded);
    const preferences = useChatPreferences();
    const withModels = providers.filter((provider) => provider.models.length > 0);

    return (
        <>
            <SettingsSection
                title="Defaults for new agents"
                description="One model per CLI, the last one picked. The composer remembers what you pick there too; this is the same default."
            >
                {withModels.length === 0 &&
                    (loaded ? (
                        <SettingsRow muted label="No agent CLI with a chat backend was found on the daemon." />
                    ) : (
                        <SettingsRow label={<Skeleton className="w-32" />} control={<Skeleton className="w-24" />} />
                    ))}
                {withModels.map((provider) => (
                    <ProviderModelRows key={provider.kind} provider={provider} preferences={preferences} />
                ))}
                <SettingsRow
                    label="Permissions"
                    control={
                        <Select
                            value={preferences.runtimeMode}
                            label="Permissions"
                            align="end"
                            items={runtimeModeItems}
                            onValueChange={(value) => rememberChatPreferences({ runtimeMode: value })}
                        />
                    }
                />
                <SettingsRow
                    label="Terminal agents start in"
                    description="An agent opened as a terminal node starts its CLI in this mode."
                    control={
                        <Select
                            value={preferences.terminalRuntimeMode}
                            label="Terminal agents start in"
                            align="end"
                            items={runtimeModeItems}
                            onValueChange={(value) => rememberChatPreferences({ terminalRuntimeMode: value })}
                        />
                    }
                />
            </SettingsSection>
            <SettingsSection title="Providers" description="What the daemon found on its PATH. Install a CLI and restart the daemon to add one.">
                {providers.length === 0 &&
                    (loaded ? (
                        <SettingsRow muted label="No providers reported" />
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
                                ? `${provider.version ? `Version ${provider.version}. ` : ''}${providerAbilities(provider)}`
                                : 'Not found on the daemon.'
                        }
                        control={provider.installed ? <Badge tone="idle">Installed</Badge> : <Badge tone="muted">Missing</Badge>}
                    />
                ))}
            </SettingsSection>
        </>
    );
}
