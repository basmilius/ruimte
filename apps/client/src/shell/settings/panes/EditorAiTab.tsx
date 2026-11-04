import { formatShortcut, Segmented, Switch } from '@adecore/ui';
import { SettingsRow } from '@adecore/ui/settings';
import { EDITOR_ASSIST_PROVIDERS, EditorAssistProviderSchema } from '@ruimte/contracts';
import { useTranslation } from 'react-i18next';
import { CANVAS_SHORTCUTS } from '@/canvas/shortcuts';
import { isApplePlatform } from '@/desktop/bridge';
import { InlineAgentPicker } from '@/editor-ai/InlineAgentPicker';
import { useEditorAssistAvailability } from '@/editor-assist/use-availability';
import { SettingsSection } from '@/shell/settings/SettingsSection';
import { SettingSwitchRow } from '@/shell/settings/SettingSwitchRow';
import { AGENT_CHANGES_MODES, GHOST_TEXT_MODES, type AgentChangesMode, type GhostTextMode } from '@/state/ai-settings';
import { useSettings } from '@/state/settings';

/* What AI does in the editor: which agent edits inline, how an agent's changes show in open files and whether the gutter says who wrote a line. */
export function EditorAiTab() {
    const { t } = useTranslation('settings');
    const assistAgent = useSettings((s) => s.aiAssistAgent);
    const inline = useSettings((s) => s.aiInlineAgent);
    const changes = useSettings((s) => s.aiAgentChanges);
    const editorAssistHelp = useSettings((s) => s.aiCodeHelp);
    const ghostText = useSettings((s) => s.aiGhostText);
    const update = useSettings((s) => s.update);
    const model = useEditorAssistAvailability();
    const unavailable = model !== null && !model.available;
    const whyNot = unavailable ? t('editor.ai.assist.unavailable', { reason: model.reason ?? '' }) : null;
    const ghostKey = formatShortcut(CANVAS_SHORTCUTS.suggestInline, isApplePlatform());

    return (
        <>
            <SettingsSection title={t('editor.ai.title')}>
                <SettingsRow
                    searchId="editor.ai.inlineAgent"
                    label={t('editor.ai.inlineAgent.label')}
                    description={t('editor.ai.inlineAgent.description')}
                    control={
                        <div className="flex items-center gap-1.5">
                            <InlineAgentPicker
                                agent={inline}
                                onChange={(agent) =>
                                    update({
                                        aiInlineAgent: {
                                            provider: agent.provider,
                                            model: agent.model,
                                            ...(agent.account === undefined ? {} : { account: agent.account })
                                        }
                                    })
                                }
                            />
                        </div>
                    }
                />
                <SettingsRow
                    searchId="editor.ai.agentChanges"
                    label={t('editor.ai.agentChanges.label')}
                    description={t('editor.ai.agentChanges.description')}
                    control={
                        <Segmented<AgentChangesMode>
                            value={changes}
                            options={AGENT_CHANGES_MODES.map((id) => ({ id, label: t(`editor.ai.agentChanges.options.${id}`) }))}
                            label={t('editor.ai.agentChanges.label')}
                            onValueChange={(value) => update({ aiAgentChanges: value })}
                        />
                    }
                />
                <SettingSwitchRow id="editor.ai.attribution" setting="aiAttribution" />
            </SettingsSection>
            <SettingsSection title={t('editor.ai.assist.title')}>
                <SettingsRow
                    searchId="editor.ai.assist.model"
                    label={t('editor.ai.assist.model.label')}
                    description={[
                        t('editor.ai.assist.model.description'),
                        whyNot ?? (model?.modelName ? t('editor.ai.assist.resolved', { model: model.modelName }) : '')
                    ]
                        .filter(Boolean)
                        .join(' ')}
                    control={
                        <div className="flex flex-wrap items-center gap-1.5">
                            <Segmented<'automatic' | 'custom'>
                                value={assistAgent === null ? 'automatic' : 'custom'}
                                options={[
                                    { id: 'automatic', label: t('editor.ai.assist.automatic') },
                                    { id: 'custom', label: t('editor.ai.assist.choose') }
                                ]}
                                label={t('editor.ai.assist.model.label')}
                                onValueChange={(value) =>
                                    update({
                                        aiAssistAgent: value === 'automatic' ? null : { provider: model?.provider ?? 'claude', model: model?.model ?? null }
                                    })
                                }
                            />
                            {assistAgent !== null && (
                                <InlineAgentPicker
                                    agent={assistAgent}
                                    kinds={EDITOR_ASSIST_PROVIDERS}
                                    capability="terminal"
                                    footer={t('editor.ai.assist.model.description')}
                                    onChange={(agent) => {
                                        const provider = EditorAssistProviderSchema.safeParse(agent.provider);
                                        if (provider.success) {
                                            update({ aiAssistAgent: { ...agent, provider: provider.data } });
                                        }
                                    }}
                                />
                            )}
                        </div>
                    }
                />
                <SettingsRow
                    searchId="editor.ai.assist.help"
                    label={t('editor.ai.assist.help.label')}
                    description={whyNot ?? t('editor.ai.assist.help.description')}
                    control={
                        <Switch
                            checked={editorAssistHelp && !unavailable}
                            disabled={unavailable}
                            onCheckedChange={(checked) => update({ aiCodeHelp: checked })}
                            label={t('editor.ai.assist.help.label')}
                        />
                    }
                />
                <SettingsRow
                    searchId="editor.ai.assist.ghost"
                    label={t('editor.ai.assist.ghost.label')}
                    description={whyNot ?? t('editor.ai.assist.ghost.description')}
                    control={
                        <Segmented<GhostTextMode>
                            value={unavailable ? 'off' : ghostText}
                            disabled={unavailable}
                            options={GHOST_TEXT_MODES.map((id) => ({
                                id,
                                label:
                                    id === 'request' ? `${t('editor.ai.assist.ghost.options.request')} ${ghostKey}` : t(`editor.ai.assist.ghost.options.${id}`)
                            }))}
                            label={t('editor.ai.assist.ghost.label')}
                            onValueChange={(value) => update({ aiGhostText: value })}
                        />
                    }
                />
            </SettingsSection>
        </>
    );
}
