import { PromptDialog } from '@adecore/ui';
import { X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { ignoreRefusal, perform } from '@/action-port/perform';
import { closeWarning } from '@/clients/project/project-sessions';
import { useAgentCloseAsk } from '@/project/agent-asks';

/* The close confirmation of the project menu, raised by an agent's `project_close`; the person's answer is the close. */
export function AgentCloseDialog() {
    const { t } = useTranslation(['shell', 'project', 'common']);
    const ask = useAgentCloseAsk((s) => s.ask);

    const close = async (): Promise<void> => {
        useAgentCloseAsk.setState({ ask: null });
        if (ask !== null) {
            await perform('project.close', { endpointId: ask.endpointId, projectId: ask.projectId }).catch(ignoreRefusal);
        }
    };

    return (
        <PromptDialog
            open={ask !== null}
            title={t('projectMenu.closeTitle', { name: ask?.name ?? '' })}
            description={ask === null ? '' : `${t('project:askClose.asked', { agent: ask.agent })} ${closeWarning(ask.sessions, ask.otherClients)}`}
            confirmLabel={t('common:action.close')}
            confirmIcon={X}
            danger={ask !== null && ask.otherClients === 0 && ask.sessions > 0}
            onConfirm={() => void close()}
            onOpenChange={() => useAgentCloseAsk.setState({ ask: null })}
        />
    );
}
