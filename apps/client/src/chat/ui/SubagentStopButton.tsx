import clsx from 'clsx';
import { Square } from 'lucide-react';
import type { ChatSubagentItem } from '@ruimte/contracts';
import { askBeforeStoppingTask } from '@/agents/end-children';
import { stopLabel, stopOf, subagentTitle } from '@/chat/subagent-list';
import { useChatRow } from '@/state/chats';
import { useEndpointId } from '@/state/keys';
import { useToasts } from '@/state/toasts';
import { machineTransport, transportFor } from '@/transport';
import { Icon } from '@/ui/Icon';
import { Tooltip } from '@/ui/Tooltip';

/* Stops one active sub-agent of a chat, or says nothing when stopping it is not on offer. */
export function SubagentStopButton({ chatId, item, className }: { chatId: string; item: ChatSubagentItem; className?: string }) {
    const endpointId = useEndpointId();
    const turnRunning = useChatRow(chatId, (row) => (row?.info.activeTurnId ?? null) !== null);
    const stop = stopOf(item, turnRunning);
    if (stop === null) {
        return null;
    }
    const send = (): void => {
        void machineTransport(endpointId)
            .request('chat.stopSubagent', { chatId, toolUseId: item.toolUseId })
            .catch((e: unknown) => {
                const description = e instanceof Error ? e.message : 'The machine did not answer';
                useToasts.getState().show({ kind: 'error', title: 'The sub-agent could not be stopped', description });
            });
    };
    const run = (): void => {
        if (stop === 'task' && item.childId !== undefined) {
            void askBeforeStoppingTask(transportFor(endpointId), item.childId, subagentTitle(item), send);
            return;
        }
        send();
    };
    return (
        <Tooltip label={stopLabel(stop)} name>
            <button type="button" className={clsx('icon-btn h-6 w-6 shrink-0', className)} onClick={run}>
                <Icon icon={Square} size={12} />
            </button>
        </Tooltip>
    );
}
