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
import { canKeepAwake } from '@/desktop/bridge';
import { DeleteAnyViewSection } from '@/shell/settings/DeleteAnyViewSection';
import { SettingsRow } from '@/shell/settings/SettingsRow';
import { SettingsSection } from '@/shell/settings/SettingsSection';
import { Badge, Skeleton, Toggle } from '@/shell/settings/controls';
import { useProviders } from '@/state/providers';
import { useSettings } from '@/state/settings';
import { Select, type SelectItem } from '@/ui/Select';

const PROVIDER_DEFAULT = '';

/* Both mode rows offer the same choices, and each one explains itself in the popup. */
const runtimeModeItems: SelectItem<RuntimeMode>[] = RUNTIME_MODES.map((mode) => ({ value: mode.id, label: mode.label, description: mode.hint }));

/* What a provider offers, in one sentence: where it can be opened and whether its hooks report status. */
const providerAbilities = (provider: ProviderInfo): string => {
    const where = provider.capabilities.chat ? 'Chat and terminal.' : 'Terminal only.';
    return `${where} ${provider.capabilities.hooks ? 'Reports agent status.' : 'Does not report agent status.'}`;
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
                description={model ? undefined : "Uses the CLI's own default model."}
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
            <SettingsSection title="Defaults for new agents" description="Picking a model in a chat also changes its default here.">
                {withModels.length === 0 &&
                    (loaded ? (
                        <SettingsRow muted label="No agent CLI with chat support found on this machine." />
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
            <SettingsSection title="What an agent may do here" description="These settings apply to this client only.">
                <SettingsRow
                    label="Ask me for permission in the node"
                    description="Permission requests from terminal agents appear in the node header, and the first answer wins. With this window in the background you also get a notification, since a request expires after a few minutes. Off, you answer in the terminal."
                    control={
                        <Toggle
                            checked={agentsApprovals}
                            onChange={(checked) => update({ agentsApprovals: checked })}
                            label="Ask me for permission in the node"
                        />
                    }
                />
                <SettingsRow
                    label="Let an agent show you a view"
                    description="On, a view an agent opens replaces the one you are working in, and a banner takes you back. Off, the banner offers a button to go there."
                    control={
                        <Toggle checked={agentsShowViews} onChange={(checked) => update({ agentsShowViews: checked })} label="Let an agent show you a view" />
                    }
                />
            </SettingsSection>
            <DeleteAnyViewSection />
            <SettingsSection title="While an agent works" description="These settings apply to this computer only.">
                <SettingsRow
                    label="Tell me when a turn ends"
                    description="Sends a notification when an agent finishes while this window is in the background."
                    control={
                        <Toggle checked={agentsTurnNotify} onChange={(checked) => update({ agentsTurnNotify: checked })} label="Tell me when a turn ends" />
                    }
                />
                {/* Not hidden with the switch above it any more: a question and a permission notify
                    whatever that one says, so this is the only answer to "may this make noise". */}
                <SettingsRow
                    label="Play a sound with a notification"
                    description="Applies to every agent notification."
                    control={
                        <Toggle
                            checked={agentsTurnSound}
                            onChange={(checked) => update({ agentsTurnSound: checked })}
                            label="Play a sound with a notification"
                        />
                    }
                />
                {/* A browser cannot keep anything awake, so it is told nothing about a switch it has no way to honor. */}
                {canKeepAwake() && (
                    <SettingsRow
                        label="Keep this computer awake"
                        description="Keeps the computer awake while an agent works, since sleep pauses the agent. The display can still turn off."
                        control={
                            <Toggle
                                checked={agentsKeepAwake}
                                onChange={(checked) => update({ agentsKeepAwake: checked })}
                                label="Keep this computer awake while an agent works"
                            />
                        }
                    />
                )}
            </SettingsSection>
            <SettingsSection title="Chats">
                <SettingsRow
                    label="Show replies"
                    control={
                        <Select
                            value={chatStreaming}
                            label="Show replies"
                            align="end"
                            items={[
                                { value: 'words', label: 'Word by word', description: 'Follows the agent as it writes.' },
                                { value: 'blocks', label: 'Paragraph by paragraph', description: 'Shows each paragraph once it is complete.' },
                                { value: 'whole', label: 'When complete', description: 'Waits until the reply is done.' }
                            ]}
                            onValueChange={(value) => update({ chatStreaming: value })}
                        />
                    }
                />
            </SettingsSection>
            <SettingsSection title="Providers" description="Agent CLIs found on the machine's PATH. To add one, install it and restart Ruimte on that machine.">
                {providers.length === 0 &&
                    (loaded ? (
                        <SettingsRow muted label="No providers found" />
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
                            provider.installed ? `${provider.version ? `Version ${provider.version}. ` : ''}${providerAbilities(provider)}` : undefined
                        }
                        control={provider.installed ? <Badge tone="idle">Installed</Badge> : <Badge tone="muted">Missing</Badge>}
                    />
                ))}
            </SettingsSection>
        </>
    );
}
