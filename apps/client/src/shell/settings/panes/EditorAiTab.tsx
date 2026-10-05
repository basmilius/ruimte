import { useTranslation } from 'react-i18next';
import { Segmented, Switch } from '@basmilius/desktop-ui';
import { SettingsRow } from '@basmilius/desktop-ui/settings';
import { InlineAgentPicker } from '@/editor-ai/InlineAgentPicker';
import { SettingsSection } from '@/shell/settings/SettingsSection';
import { AGENT_CHANGES_MODES, type AgentChangesMode } from '@/state/ai-settings';
import { useSettings } from '@/state/settings';

/* What AI does in the editor: which agent edits inline, how an agent's changes show in open files and whether the gutter says who wrote a line. */
export function EditorAiTab() {
    const { t } = useTranslation('settings');
    const inline = useSettings((s) => s.aiInlineAgent);
    const changes = useSettings((s) => s.aiAgentChanges);
    const attribution = useSettings((s) => s.aiAttribution);
    const update = useSettings((s) => s.update);

    return (
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
                    <Switch checked={attribution} onCheckedChange={(checked) => update({ aiAttribution: checked })} label={t('editor.ai.attribution.label')} />
                }
            />
        </SettingsSection>
    );
}
