import { PromptDialog } from '@adecore/ui';
import { FolderOpen } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { openFolderAction } from '@/actions/client-actions';
import { useAgentFolderAsk } from '@/project/agent-project-watch';

/* The confirmation an agent's `project_open` of a folder raised; the person's answer is their own open of the folder. */
export function AgentOpenFolderDialog() {
    const { t } = useTranslation(['project', 'common']);
    const ask = useAgentFolderAsk((s) => s.ask);

    const open = (): void => {
        useAgentFolderAsk.setState({ ask: null });

        if (ask !== null) {
            openFolderAction(ask.endpointId, ask.folder, false);
        }
    };

    return (
        <PromptDialog
            open={ask !== null}
            title={t('project:askOpen.title')}
            description={ask === null ? '' : t('project:askOpen.asked', { agent: ask.agent, folder: ask.folder })}
            confirmLabel={t('common:action.open')}
            confirmIcon={FolderOpen}
            onConfirm={open}
            onOpenChange={() => useAgentFolderAsk.setState({ ask: null })}
        />
    );
}
