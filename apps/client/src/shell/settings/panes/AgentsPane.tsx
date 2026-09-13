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
            <SettingsSection
                title="Defaults for new agents"
                description="One model per CLI, the last one picked. The composer remembers what you pick there too; this is the same default."
            >
                {withModels.length === 0 &&
                    (loaded ? (
                        <SettingsRow muted label="No agent CLI with a chat backend was found on this machine." />
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
            <SettingsSection
                title="What an agent may do here"
                description="These are about this client: what an agent makes is shared, what it may ask of you at this screen is not."
            >
                <SettingsRow
                    label="Ask me for permission in the node"
                    description="On, a permission a terminal agent asks for appears in the node's header with the choices the CLI offers, and the first answer settles it. One that arrives while this window is not in front also comes as a notification, since the machine only holds the question for a couple of minutes. Off, nothing is asked here and the CLI's own prompt in the terminal is the only place to answer; a second client that wants them still gets asked."
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
                    description="Off, a view an agent asks for waits in the banner over the ones you have open, with a button to go there. On, it takes the place of the view you are working in and the same banner offers the way back."
                    control={
                        <Toggle checked={agentsShowViews} onChange={(checked) => update({ agentsShowViews: checked })} label="Let an agent show you a view" />
                    }
                />
            </SettingsSection>
            <DeleteAnyViewSection />
            <SettingsSection title="While an agent works" description="About the computer this window runs on, so these stay with this app and travel nowhere.">
                <SettingsRow
                    label="Tell me when a turn ends"
                    description="A notification when an agent finishes while this window is not the one in front. A node that finished out of sight keeps a mark until you look at it either way."
                    control={
                        <Toggle checked={agentsTurnNotify} onChange={(checked) => update({ agentsTurnNotify: checked })} label="Tell me when a turn ends" />
                    }
                />
                {/* Not hidden with the switch above it any more: a question and a permission notify
                    whatever that one says, so this is the only answer to "may this make noise". */}
                <SettingsRow
                    label="Play a sound with a notification"
                    description="Off, every notification arrives quietly, which is what you want in whatever you walked away to do."
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
                        label="Keep this machine awake"
                        description="Off, the computer sleeps as it always does and an agent running on it stops until you come back. On, it stays awake from the first agent that starts until the last one settles. The display still goes dark."
                        control={
                            <Toggle
                                checked={agentsKeepAwake}
                                onChange={(checked) => update({ agentsKeepAwake: checked })}
                                label="Keep this machine awake while an agent works"
                            />
                        }
                    />
                )}
            </SettingsSection>
            <SettingsSection title="Chats" description="How a chat node on this client draws what an agent writes.">
                <SettingsRow
                    label="Stream replies"
                    description="On, a reply appears word by word as the agent writes it. Off, it appears in one piece once it is done."
                    control={<Toggle checked={chatStreaming} onChange={(checked) => update({ chatStreaming: checked })} label="Stream replies" />}
                />
            </SettingsSection>
            <SettingsSection title="Providers" description="What the machine found on its PATH. Install a CLI and restart Ruimte there to add one.">
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
                                : 'Not found on this machine.'
                        }
                        control={provider.installed ? <Badge tone="idle">Installed</Badge> : <Badge tone="muted">Missing</Badge>}
                    />
                ))}
            </SettingsSection>
        </>
    );
}
