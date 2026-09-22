import { Popover } from '@base-ui-components/react/popover';
import clsx from 'clsx';
import { useTranslation } from 'react-i18next';
import { Activity, Bot, Square, SquareTerminal } from 'lucide-react';
import type { ChatBackgroundTask } from '@ruimte/contracts';
import { backgroundCounts, runningOwnSubagents } from '@/chat/activity';
import { toggleList, useOpenableSubagents, useSubagentTrail } from '@/chat/subagent-view';
import { formatElapsedShort } from '@/format/duration';
import { useChatRow } from '@/state/chats';
import { useEndpointId } from '@/state/keys';
import { useToasts } from '@/state/toasts';
import { machineTransport } from '@/transport';
import { FLOAT } from '@/ui/classes';
import { Icon } from '@/ui/Icon';
import { Tooltip } from '@/ui/Tooltip';
import { useNow } from '@/ui/useNow';

const NO_TASKS: readonly ChatBackgroundTask[] = [];

const CHIP = `${FLOAT} pointer-events-auto inline-flex h-7.5 items-center gap-1.5 rounded-full px-3 text-xs text-text-muted`;

/* What the chat keeps working on beside the thread, in one small line over the composer: its sub-agents and what runs in the background. */
export function ChatActivity({ chatId }: { chatId: string }) {
    const { t } = useTranslation('chat');
    const subagents = useChatRow(chatId, (row) => runningOwnSubagents(row?.structure));
    const background = useChatRow(chatId, (row) => row?.info.background) ?? NO_TASKS;
    const openable = useOpenableSubagents(chatId).length > 0;
    const { trail, show } = useSubagentTrail(chatId);
    if (subagents === 0 && background.length === 0) {
        return null;
    }
    const { shells, monitors } = backgroundCounts(background);
    const subagentLabel = t('activity.subagents', { count: subagents });
    return (
        <div className="mb-3 flex flex-wrap items-center gap-2">
            {subagents > 0 &&
                (openable ? (
                    <Tooltip label={t('activity.openSubagents')} name>
                        <button type="button" className={clsx(CHIP, 'hover:text-text')} onClick={() => show(toggleList(trail))}>
                            <Icon icon={Bot} size={14} />
                            {subagentLabel}
                        </button>
                    </Tooltip>
                ) : (
                    <span className={CHIP}>
                        <Icon icon={Bot} size={14} />
                        {subagentLabel}
                    </span>
                ))}
            {background.length > 0 && (
                <Popover.Root>
                    <Popover.Trigger className={clsx(CHIP, 'hover:text-text')}>
                        <Icon icon={shells > 0 ? SquareTerminal : Activity} size={14} />
                        {[shells > 0 && t('activity.shells', { count: shells }), monitors > 0 && t('activity.monitors', { count: monitors })]
                            .filter(Boolean)
                            .join(' · ')}
                    </Popover.Trigger>
                    <Popover.Portal>
                        <Popover.Positioner side="top" sideOffset={8} align="start" className="z-(--z-popup)">
                            <Popover.Popup className="menu-popup w-80">
                                <div className="px-2.5 pt-1.5 pb-1 text-xs text-text-faint">{t('activity.background')}</div>
                                <BackgroundTaskRows chatId={chatId} tasks={background} />
                            </Popover.Popup>
                        </Popover.Positioner>
                    </Popover.Portal>
                </Popover.Root>
            )}
        </div>
    );
}

/* Only drawn while the popup is open, so the clock ticks for nobody otherwise. */
function BackgroundTaskRows({ chatId, tasks }: { chatId: string; tasks: readonly ChatBackgroundTask[] }) {
    const { t } = useTranslation('chat');
    const endpointId = useEndpointId();
    const now = useNow(1000);

    function stop(taskId: string): void {
        void machineTransport(endpointId)
            .request('chat.stopTask', { chatId, taskId })
            .catch((e: unknown) => {
                const description = e instanceof Error ? e.message : t('subagents.noAnswer');
                useToasts.getState().show({ kind: 'error', title: t('activity.stopFailed'), description });
            });
    }

    return tasks.map((task) => (
        <div key={task.id} className="flex items-center gap-2 rounded-md px-2.5 py-1.5">
            <Icon icon={task.kind === 'shell' ? SquareTerminal : Activity} size={14} className="shrink-0 text-text-faint" />
            <span className="flex min-w-0 grow flex-col">
                <span className="truncate text-xs text-text">{task.description || task.command || t(`activity.${task.kind}`)}</span>
                {task.command && task.description && <span className="truncate font-mono text-xs text-text-faint">{task.command}</span>}
            </span>
            <span className="shrink-0 text-xs tabular-nums text-text-faint">{formatElapsedShort(now - task.startedAt)}</span>
            <Tooltip label={t('activity.stop')} name>
                <button type="button" className="icon-btn h-6 w-6 shrink-0" onClick={() => stop(task.id)}>
                    <Icon icon={Square} size={14} />
                </button>
            </Tooltip>
        </div>
    ));
}
