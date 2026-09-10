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
import { Badge, SelectControl, Toggle } from '@/shell/settings/controls';
import { useProviders } from '@/state/providers';

const PROVIDER_DEFAULT = '';

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
                        description={option.choices.find((choice) => choice.id === (options[option.id] ?? option.defaultChoice))?.description}
                        control={
                            <SelectControl
                                value={String(options[option.id] ?? option.defaultChoice)}
                                label={option.label}
                                onChange={(value) => setOption(option.id, value)}
                            >
                                {option.choices.map((choice) => (
                                    <option key={choice.id} value={choice.id}>
                                        {choice.label}
                                    </option>
                                ))}
                            </SelectControl>
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
                description="Provider default follows the CLI's own choice."
                control={
                    <SelectControl
                        value={model?.slug ?? PROVIDER_DEFAULT}
                        label={`Default model for ${provider.name}`}
                        onChange={(value) =>
                            value === PROVIDER_DEFAULT
                                ? forgetChatSelection(provider.kind)
                                : rememberChatSelection(provider.kind, { model: value, options: {} })
                        }
                    >
                        <option value={PROVIDER_DEFAULT}>Provider default</option>
                        {provider.models.map((entry) => (
                            <option key={entry.slug} value={entry.slug}>
                                {entry.name}
                                {entry.legacy ? ' (legacy)' : ''}
                            </option>
                        ))}
                    </SelectControl>
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
    const runtime = RUNTIME_MODES.find((mode) => mode.id === preferences.runtimeMode);

    return (
        <>
            <SettingsSection
                title="Defaults for new agents"
                description="One model per CLI, the last one picked. The composer remembers what you pick there too; this is the same default."
            >
                {withModels.length === 0 && (
                    <SettingsRow
                        muted
                        label={loaded ? 'No agent CLI with a chat backend was found on the daemon.' : 'Waiting for the daemon to list its providers.'}
                    />
                )}
                {withModels.map((provider) => (
                    <ProviderModelRows key={provider.kind} provider={provider} preferences={preferences} />
                ))}
                <SettingsRow
                    label="Permissions"
                    description={runtime?.hint}
                    control={
                        <SelectControl
                            value={preferences.runtimeMode}
                            label="Permissions"
                            onChange={(value) => rememberChatPreferences({ runtimeMode: value as RuntimeMode })}
                        >
                            {RUNTIME_MODES.map((mode) => (
                                <option key={mode.id} value={mode.id}>
                                    {mode.label}
                                </option>
                            ))}
                        </SelectControl>
                    }
                />
                <SettingsRow
                    label="Terminal agents start in"
                    description="An agent opened as a terminal node starts its CLI in this mode."
                    control={
                        <SelectControl
                            value={preferences.terminalRuntimeMode}
                            label="Terminal agents start in"
                            onChange={(value) => rememberChatPreferences({ terminalRuntimeMode: value as RuntimeMode })}
                        >
                            {RUNTIME_MODES.map((mode) => (
                                <option key={mode.id} value={mode.id}>
                                    {mode.label}
                                </option>
                            ))}
                        </SelectControl>
                    }
                />
            </SettingsSection>
            <SettingsSection title="Providers" description="What the daemon found on its PATH. Install a CLI and restart the daemon to add one.">
                {providers.length === 0 && <SettingsRow muted label={loaded ? 'No providers reported' : 'Waiting for the daemon'} />}
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
