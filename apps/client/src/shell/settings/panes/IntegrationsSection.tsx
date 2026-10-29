import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { AgentIntegrationFile } from '@ruimte/contracts';
import { CliMark } from '@adecore/agents-react/providers';
import { SettingsRow } from '@adecore/ui/settings';
import { FormError, Switch } from '@adecore/ui';
import { IntegrationDetails, IntegrationReports } from '@/shell/AgentIntegrationsDialog';
import { SettingsSection } from '@/shell/settings/SettingsSection';
import { INTEGRATION_NAMES, loadIntegrationFiles, useAgentIntegrations, useIntegrationChoice } from '@/state/agent-integrations';
import { hasLocalMachine } from '@/state/local-machine';

/* What Ruimte may write into the CLIs' global settings, per CLI, so a terminal shows its agent's status. Only this computer's own machine has it. */
export function IntegrationsSection() {
    const { t } = useTranslation('settings');
    const summary = useAgentIntegrations();
    const [files, setFiles] = useState<AgentIntegrationFile[] | null>(null);
    const { reports, busy, error, change } = useIntegrationChoice();
    const listed = summary !== null && hasLocalMachine();

    useEffect(() => {
        if (listed) {
            void loadIntegrationFiles()
                .then(setFiles)
                .catch(() => setFiles([]));
        }
    }, [listed, summary]);

    if (!listed) {
        return null;
    }

    return (
        <SettingsSection
            title={t('agents.integrations.title')}
            description={summary.fixed ? `${t('agents.integrations.description')} ${t('agents.integrations.fixed')}` : t('agents.integrations.description')}
            scope="computer"
        >
            {summary.providers.map((entry, index) => (
                <SettingsRow
                    key={entry.provider}
                    searchId={index === 0 ? 'agents.integrations' : undefined}
                    label={INTEGRATION_NAMES[entry.provider] ?? entry.provider}
                    leading={<CliMark kind={entry.provider} size={20} />}
                    control={
                        <Switch
                            checked={entry.state === 'on'}
                            disabled={summary.fixed || busy !== null}
                            onCheckedChange={(checked) => void change(entry.provider, checked)}
                            label={INTEGRATION_NAMES[entry.provider] ?? entry.provider}
                        />
                    }
                >
                    <IntegrationDetails entry={entry} files={files} />
                    {reports[entry.provider] !== undefined && <IntegrationReports reports={reports[entry.provider]!} />}
                    {error?.provider === entry.provider && <FormError>{error.message}</FormError>}
                </SettingsRow>
            ))}
        </SettingsSection>
    );
}
