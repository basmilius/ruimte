import { useTranslation } from 'react-i18next';
import { formatShortcut, Segmented, Switch } from '@adecore/ui';
import { SettingsRow } from '@adecore/ui/settings';
import { InlineAgentPicker } from '@/editor-ai/InlineAgentPicker';
import { SettingsSection } from '@/shell/settings/SettingsSection';
import { CANVAS_SHORTCUTS } from '@/canvas/shortcuts';
import { isApplePlatform } from '@/desktop/bridge';
import { useOnDeviceAvailability } from '@/ondevice/use-availability';
import { AGENT_CHANGES_MODES, GHOST_TEXT_MODES, type AgentChangesMode, type GhostTextMode } from '@/state/ai-settings';
import { useSettings } from '@/state/settings';

/* What AI does in the editor: which agent edits inline, how an agent's changes show in open files and whether the gutter says who wrote a line. */
export function EditorAiTab() {
    const { t } = useTranslation('settings');
    const inline = useSettings((s) => s.aiInlineAgent);
    const changes = useSettings((s) => s.aiAgentChanges);
    const attribution = useSettings((s) => s.aiAttribution);
    const onDeviceHelp = useSettings((s) => s.aiOnDeviceHelp);
    const ghostText = useSettings((s) => s.aiGhostText);
    const update = useSettings((s) => s.update);
    const model = useOnDeviceAvailability();
    const unavailable = model !== null && !model.available;
    const whyNot = unavailable ? t('editor.ai.onDevice.unavailable', { reason: model.reason ?? '' }) : null;
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
                <SettingsRow
                    searchId="editor.ai.attribution"
                    label={t('editor.ai.attribution.label')}
                    description={t('editor.ai.attribution.description')}
                    control={
                        <Switch
                            checked={attribution}
                            onCheckedChange={(checked) => update({ aiAttribution: checked })}
                            label={t('editor.ai.attribution.label')}
                        />
                    }
                />
            </SettingsSection>
            <SettingsSection title={t('editor.ai.onDevice.title')}>
                <SettingsRow
                    searchId="editor.ai.onDevice.help"
                    label={t('editor.ai.onDevice.help.label')}
                    description={whyNot ?? t('editor.ai.onDevice.help.description')}
                    control={
                        <Switch
                            checked={onDeviceHelp && !unavailable}
                            disabled={unavailable}
                            onCheckedChange={(checked) => update({ aiOnDeviceHelp: checked })}
                            label={t('editor.ai.onDevice.help.label')}
                        />
                    }
                />
                <SettingsRow
                    searchId="editor.ai.onDevice.ghost"
                    label={t('editor.ai.onDevice.ghost.label')}
                    description={whyNot ?? t('editor.ai.onDevice.ghost.description')}
                    control={
                        <Segmented<GhostTextMode>
                            value={unavailable ? 'off' : ghostText}
                            disabled={unavailable}
                            options={GHOST_TEXT_MODES.map((id) => ({
                                id,
                                label:
                                    id === 'request'
                                        ? `${t('editor.ai.onDevice.ghost.options.request')} ${ghostKey}`
                                        : t(`editor.ai.onDevice.ghost.options.${id}`)
                            }))}
                            label={t('editor.ai.onDevice.ghost.label')}
                            onValueChange={(value) => update({ aiGhostText: value })}
                        />
                    }
                />
            </SettingsSection>
        </>
    );
}
