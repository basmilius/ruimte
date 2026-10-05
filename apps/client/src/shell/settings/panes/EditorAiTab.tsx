import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Segmented, Switch } from '@basmilius/desktop-ui';
import { SettingsRow } from '@basmilius/desktop-ui/settings';
import { ModelPicker } from '@ruimte/agents-react/chat/ui/Pickers';
import { useProviders } from '@ruimte/agents-react/state/providers';
import { availableAgents } from '@/agents/creation';
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
    const providers = useProviders((s) => s.providers);
    const [open, setOpen] = useState(false);
    const offered = availableAgents(providers, 'chat');
    const owner = providers.find((provider) => provider.kind === inline.provider);

    return (
        <SettingsSection title={t('editor.ai.title')}>
            <SettingsRow
                searchId="editor.ai.inlineAgent"
                label={t('editor.ai.inlineAgent.label')}
                description={t('editor.ai.inlineAgent.description')}
                control={
                    offered.length === 0 ? (
                        <span className="text-sm text-text-muted">{t('editor.ai.inlineAgent.none')}</span>
                    ) : (
                        <ModelPicker
                            providers={offered}
                            provider={inline.provider}
                            selection={{ model: inline.model ?? owner?.defaultModel ?? '', options: {} }}
                            open={open}
                            onOpenChange={setOpen}
                            onChange={(provider, model) => update({ aiInlineAgent: { provider, model } })}
                            kbd={null}
                            side="bottom"
                        />
                    )
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
