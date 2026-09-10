import type { InteractionMode, ModelInfo, ProviderInfo, RuntimeMode } from '@ruimte/contracts';
import { rememberChatPreferences, useChatPreferences } from '@/chat/preferences';
import { RUNTIME_MODES } from '@/chat/runtime-modes';
import { SettingsRow } from '@/shell/settings/SettingsRow';
import { SettingsSection } from '@/shell/settings/SettingsSection';
import { Badge, Segmented, SelectControl, Toggle } from '@/shell/settings/controls';
import { findModel, useProviders } from '@/state/providers';

const PROVIDER_DEFAULT = '';

/* What a provider offers, in one sentence: where it can be opened and whether its hooks report status. */
const providerAbilities = (provider: ProviderInfo): string => {
    const where = provider.capabilities.chat ? 'Chat and terminal.' : 'Terminal only.';
    return `${where} ${provider.capabilities.hooks ? 'Reports status through its hooks.' : 'No status beyond the session itself.'}`;
};

const APPROACHES: Array<{ id: InteractionMode; label: string }> = [
    { id: 'default', label: 'Build' },
    { id: 'plan', label: 'Plan' }
];

/* One row per knob the chosen model exposes; the composer's option picker shows the same descriptors. */
function ModelOptionRows({ model, options }: { model: ModelInfo; options: Record<string, string | boolean> }) {
    const setOption = (id: string, value: string | boolean): void => {
        rememberChatPreferences({ selection: { model: model.slug, options: { ...options, [id]: value } } });
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

export function AgentsPane() {
    const providers = useProviders((s) => s.providers);
    const loaded = useProviders((s) => s.loaded);
    const preferences = useChatPreferences();
    const withModels = providers.filter((provider) => provider.models.length > 0);
    const selectedSlug = preferences.selection?.model ?? PROVIDER_DEFAULT;
    const selectedModel = preferences.selection ? findModel(providers, preferences.selection.model) : undefined;
    const runtime = RUNTIME_MODES.find((mode) => mode.id === preferences.runtimeMode);

    return (
        <>
            <SettingsSection title="Defaults for new agents" description="The composer remembers what you pick there too; this is the same default.">
                <SettingsRow
                    label="Model"
                    description={
                        withModels.length === 0
                            ? loaded
                                ? 'No agent CLI with a chat backend was found on the daemon.'
                                : 'Waiting for the daemon to list its providers.'
                            : "Provider default follows the CLI's own choice."
                    }
                    control={
                        <SelectControl
                            value={selectedSlug}
                            label="Default model"
                            onChange={(value) => rememberChatPreferences({ selection: value === PROVIDER_DEFAULT ? null : { model: value, options: {} } })}
                        >
                            <option value={PROVIDER_DEFAULT}>Provider default</option>
                            {withModels.map((provider) => (
                                <optgroup key={provider.kind} label={provider.name}>
                                    {provider.models.map((model) => (
                                        <option key={model.slug} value={model.slug}>
                                            {model.name}
                                            {model.legacy ? ' (legacy)' : ''}
                                        </option>
                                    ))}
                                </optgroup>
                            ))}
                        </SelectControl>
                    }
                />
                {selectedModel && <ModelOptionRows model={selectedModel} options={preferences.selection?.options ?? {}} />}
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
                <SettingsRow
                    label="Approach"
                    description="Plan has the agent propose first; Build goes straight to work."
                    control={
                        <Segmented
                            value={preferences.interactionMode}
                            options={APPROACHES}
                            label="Approach"
                            onChange={(value) => rememberChatPreferences({ interactionMode: value })}
                        />
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
