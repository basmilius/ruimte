import { useMemo, type ReactNode } from 'react';
import { Popover } from '@base-ui-components/react/popover';
import clsx from 'clsx';
import { useTranslation } from 'react-i18next';
import { Activity, Square, SquareTerminal } from 'lucide-react';
import type { ChatBackgroundTask, ChatSubagentItem } from '@ruimte/contracts';
import { performAsPerson } from '@/actions/client-actions';
import { backgroundCounts } from '@/chat/activity';
import { badgeCountOf, entryTimeOf, flyoutSubagents, statusWordOf, subagentTitle, summaryWordOf, taskIdOf } from '@/chat/subagent-list';
import { useSubagentSupport } from '@/chat/subagent-support';
import { canOpenSubagent, crumbOf, openFromMain, useSubagentTrail } from '@/chat/subagent-view';
import { SubagentStopButton } from '@/chat/ui/SubagentStopButton';
import { formatElapsedShort } from '@/format/duration';
import { useChatRow } from '@/state/chats';
import { useEndpointId } from '@/state/keys';
import { useTasks } from '@/state/tasks';
import { useToasts } from '@/state/toasts';
import { FLOAT } from '@ruimte/ui/classes';
import { Icon } from '@ruimte/ui/Icon';
import { statusLookOf, type StatusWord } from '@/ui/status-look';
import { Tooltip } from '@ruimte/ui/Tooltip';
import { useNow } from '@ruimte/ui/useNow';

const NO_TASKS: readonly ChatBackgroundTask[] = [];

const NO_ITEMS: readonly string[] = [];

const CHIP = `${FLOAT} pointer-events-auto inline-flex h-7.5 items-center gap-1.5 rounded-full px-3 text-xs text-text-muted hover:text-text`;

const ROW_BODY = 'flex min-h-9 min-w-0 grow items-center gap-2.5 rounded-md px-2.5 py-1.5 text-left';

/* What the chat keeps working on beside the thread, in one small line over the composer: its sub-agents and what runs in the background. */
export function ChatActivity({ chatId }: { chatId: string }) {
    const { t } = useTranslation('chat');
    const order = useChatRow(chatId, (row) => row?.order) ?? NO_ITEMS;
    const structure = useChatRow(chatId, (row) => row?.structure);
    const subagents = useMemo(() => (structure === undefined ? [] : flyoutSubagents(order, structure)), [order, structure]);
    const endpointId = useEndpointId();
    const tasks = useTasks((s) => s.byEndpoint[endpointId]);
    const words = useMemo(
        () =>
            subagents.map((item) => {
                const taskId = taskIdOf(item);
                return statusWordOf(item, taskId === null ? null : (tasks?.[taskId] ?? null));
            }),
        [subagents, tasks]
    );
    const background = useChatRow(chatId, (row) => row?.info.background) ?? NO_TASKS;
    if (subagents.length === 0 && background.length === 0) {
        return null;
    }
    const { shells, monitors } = backgroundCounts(background);
    return (
        <div className="mb-3 flex flex-wrap items-center gap-2">
            {subagents.length > 0 && (
                <Flyout
                    icon={<StatusIcon word={summaryWordOf(words)} />}
                    label={t('activity.subagents', { count: badgeCountOf(words) })}
                    heading={t('activity.subagents', { count: subagents.length })}
                >
                    <SubagentRows chatId={chatId} items={subagents} />
                </Flyout>
            )}
            {background.length > 0 && (
                <Flyout
                    icon={<Icon icon={shells > 0 ? SquareTerminal : Activity} size={14} />}
                    label={[shells > 0 && t('activity.shells', { count: shells }), monitors > 0 && t('activity.monitors', { count: monitors })]
                        .filter(Boolean)
                        .join(' · ')}
                >
                    <BackgroundTaskRows chatId={chatId} tasks={background} />
                </Flyout>
            )}
        </div>
    );
}

function StatusIcon({ word }: { word: StatusWord }) {
    const look = statusLookOf(word);
    return <Icon icon={look.icon} size={14} className={clsx('shrink-0', look.tone, look.spins && 'animate-spin')} />;
}

/* A chip that opens a list over it, headed by what the chip says unless the list counts more than the chip does. */
function Flyout({ icon, label, heading = label, children }: { icon: ReactNode; label: string; heading?: string; children: ReactNode }) {
    return (
        <Popover.Root>
            <Popover.Trigger className={CHIP}>
                {icon}
                {label}
            </Popover.Trigger>
            <Popover.Portal>
                <Popover.Positioner side="top" sideOffset={8} align="start" className="z-(--z-popup)">
                    <Popover.Popup className="menu-popup w-80">
                        <div className="px-2.5 pt-1.5 pb-1 text-xs text-text-faint">{heading}</div>
                        {children}
                    </Popover.Popup>
                </Popover.Positioner>
            </Popover.Portal>
        </Popover.Root>
    );
}

/* One line of a flyout; with `onOpen` the line leads somewhere and closes the flyout on the way. */
function ActivityRow({
    icon,
    title,
    detail,
    time,
    onOpen,
    children
}: {
    icon: ReactNode;
    title: ReactNode;
    detail?: string | null;
    time: string;
    onOpen?: () => void;
    children?: ReactNode;
}) {
    const body = (
        <>
            {icon}
            <span className="flex min-w-0 grow flex-col">
                <span className="truncate text-sm text-text">{title}</span>
                {detail && <span className="truncate font-mono text-xs text-text-faint">{detail}</span>}
            </span>
            {time !== '' && <span className="shrink-0 text-xs text-text-faint tabular-nums">{time}</span>}
        </>
    );
    // The stop is a button of its own beside the line, since a button cannot hold another.
    return (
        <div className={clsx('flex items-center gap-1 rounded-md', onOpen && 'hover:bg-surface-hover')}>
            {onOpen ? (
                <Popover.Close className={ROW_BODY} onClick={onOpen}>
                    {body}
                </Popover.Close>
            ) : (
                <div className={ROW_BODY}>{body}</div>
            )}
            {children}
        </div>
    );
}

/* Only drawn while the flyout is open, so the clock ticks for nobody otherwise. */
function SubagentRows({ chatId, items }: { chatId: string; items: readonly ChatSubagentItem[] }) {
    const now = useNow(
        1000,
        items.some((item) => item.status === 'running')
    );
    return items.map((item) => <SubagentEntry key={item.id} chatId={chatId} item={item} now={now} />);
}

function SubagentEntry({ chatId, item, now }: { chatId: string; item: ChatSubagentItem; now: number }) {
    const { t } = useTranslation('common');
    const endpointId = useEndpointId();
    const refused = useSubagentSupport((s) => s.unsupported[endpointId] === true);
    const taskId = taskIdOf(item);
    const task = useTasks((s) => (taskId === null ? null : (s.byEndpoint[endpointId]?.[taskId] ?? null)));
    const { show } = useSubagentTrail(chatId);
    const word = statusWordOf(item, task);
    return (
        <ActivityRow
            icon={<StatusIcon word={word} />}
            title={
                <>
                    {subagentTitle(item)}
                    {/* The icon says the state to the eye; a screen reader hears it with the title. */}
                    <span className="sr-only">, {t(`status.${word}`)}</span>
                </>
            }
            time={entryTimeOf(item, task, now)}
            onOpen={canOpenSubagent(item, refused) ? () => show(openFromMain(crumbOf(item))) : undefined}
        >
            <SubagentStopButton chatId={chatId} item={item} className="mr-1.5" />
        </ActivityRow>
    );
}

/* Only drawn while the flyout is open, so the clock ticks for nobody otherwise. */
function BackgroundTaskRows({ chatId, tasks }: { chatId: string; tasks: readonly ChatBackgroundTask[] }) {
    const { t } = useTranslation('chat');
    const now = useNow(1000);

    function stop(taskId: string): void {
        void performAsPerson('chat.stopTask', { chatId, taskId }).catch((e: unknown) => {
            const description = e instanceof Error ? e.message : t('subagents.noAnswer');
            useToasts.getState().show({ kind: 'error', title: t('activity.stopFailed'), description });
        });
    }

    return tasks.map((task) => (
        <ActivityRow
            key={task.id}
            icon={<Icon icon={task.kind === 'shell' ? SquareTerminal : Activity} size={14} className="shrink-0 text-text-faint" />}
            title={task.description || task.command || t(`activity.${task.kind}`)}
            detail={task.description ? task.command : null}
            time={formatElapsedShort(now - task.startedAt)}
        >
            <Tooltip label={t('activity.stop')} name>
                <button type="button" className="icon-btn icon-btn-xs mr-1.5" onClick={() => stop(task.id)}>
                    <Icon icon={Square} size={12} />
                </button>
            </Tooltip>
        </ActivityRow>
    ));
}
