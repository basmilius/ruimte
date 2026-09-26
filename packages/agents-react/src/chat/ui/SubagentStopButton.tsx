import clsx from 'clsx';
import { useTranslation } from 'react-i18next';
import { Square } from 'lucide-react';
import type { ChatSubagentItem } from '@ruimte/agent-contracts';
import { chatHost } from '../../host';
import { useChatScope } from '../../scope';
import { useChatRow } from '../../state/chats';
import { useChatActions } from '../actions';
import { stopLabel, stopOf, subagentTitle } from '../subagent-list';
import { Icon } from '@ruimte/ui/Icon';
import { Tooltip } from '@ruimte/ui/Tooltip';

/* Stops one active sub-agent of a chat, or says nothing when stopping it is not on offer. */
export function SubagentStopButton({
    chatId,
    item,
    size = 'xs',
    className
}: {
    chatId: string;
    item: ChatSubagentItem;
    size?: 'sm' | 'xs';
    className?: string;
}) {
    const { t } = useTranslation('agent-chat');
    const { id } = useChatScope();
    const actions = useChatActions();
    const turnRunning = useChatRow(chatId, (row) => (row?.info.activeTurnId ?? null) !== null);
    const stop = stopOf(item, turnRunning);
    if (stop === null) {
        return null;
    }
    const send = (): void => {
        void actions.stopSubagent(chatId, item.toolUseId).catch((e: unknown) => {
            const description = e instanceof Error ? e.message : t('subagents.noAnswer');
            chatHost().notify({ kind: 'error', title: t('subagents.stopFailed'), description });
        });
    };
    const run = (): void => {
        if (stop === 'task' && item.childId !== undefined) {
            chatHost().confirm.stopTask(id, item.childId, subagentTitle(item), send);
            return;
        }
        send();
    };
    return (
        <Tooltip label={stopLabel(stop)} name>
            <button type="button" className={clsx('icon-btn', size === 'sm' ? 'icon-btn-sm' : 'icon-btn-xs', className)} onClick={run}>
                <Icon icon={Square} size={size === 'sm' ? 14 : 12} />
            </button>
        </Tooltip>
    );
}
