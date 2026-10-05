import clsx from 'clsx';
import { useTranslation } from 'react-i18next';
import { Bot, ChevronRight } from 'lucide-react';
import type { ChatSubagentItem } from '@ruimte/agent-contracts';
import { formatElapsedShort, formatMoment } from '@adecore/ui/format';
import { Icon, useNow, useTickingText } from '@adecore/ui';
import { AgentIcon } from '../../../agents/AgentIcon';
import { modelName, shortModelName } from '../../../agents/model-name';
import type { SubagentTask } from '../../../host';
import { useChatScope } from '../../../scope';
import { useChats } from '../../../state/chats';
import { useProviders } from '../../../state/providers';
import { taskRowStateOf, type TaskRowState } from '../../subagent-list';

const DOT: Record<TaskRowState, string> = {
    running: 'bg-status-running',
    waiting: 'bg-status-needs-you',
    paused: 'bg-text-faint',
    done: 'bg-status-idle',
    failed: 'bg-status-error',
    cancelled: 'bg-text-faint'
};

const STATE_TONE: Record<TaskRowState, string> = {
    running: 'text-text-muted chat-live-text',
    waiting: 'text-status-needs-you',
    paused: 'text-text-faint',
    done: 'text-text-faint',
    failed: 'text-status-error',
    cancelled: 'text-text-faint'
};

function Elapsed({ startedAt }: { startedAt: number }) {
    const ref = useTickingText(() => formatElapsedShort(Date.now() - startedAt));
    return <span ref={ref} className="shrink-0 text-xs text-text-faint tabular-nums" />;
}

function StateLine({ state, task }: { state: TaskRowState; task: SubagentTask | null }) {
    const { t } = useTranslation('agent-chat');
    const until = state === 'paused' ? task?.paused?.until : undefined;
    const now = useNow(60_000, until === undefined);
    return (
        <span className={clsx('truncate text-xs', STATE_TONE[state])}>
            {until === undefined ? t(`rows.task.${state}`) : t('rows.task.pausedUntil', { time: formatMoment(until, now) })}
        </span>
    );
}

/*
 * The row of a task given to another node: that agent's mark and model, what the task is about and
 * where it stands, read from the status every client gets of the child's chat. A child without one,
 * a terminal or a node that is gone, keeps the task's own words.
 */
export function TaskRow({ item, task, open, onPress }: { item: ChatSubagentItem; task: SubagentTask | null; open: boolean; onPress(): void }) {
    const { t } = useTranslation('agent-chat');
    const { keyOf } = useChatScope();
    const child = useChats((s) => (item.childId === undefined ? undefined : s.statusByKey[keyOf(item.childId)]?.info));
    const provider = child?.provider;
    const slug = child?.model ?? child?.selection.model ?? null;
    const model = useProviders((s) => {
        if (slug === null) {
            return null;
        }
        const models = s.providers.find((entry) => entry.kind === provider)?.models;
        return shortModelName(modelName(slug, models), models);
    });
    const state = taskRowStateOf(item, task, child);
    const title = item.description || t('rows.subagent.task');
    const startedAt = task?.createdAt ?? item.startedAt;
    const finishedAt = task === null ? item.finishedAt : (task.settledAt ?? item.finishedAt);
    const settled = state === 'done' || state === 'failed' || state === 'cancelled';
    return (
        <button
            className="-mx-1 mb-0.5 flex w-[calc(100%+8px)] items-center gap-2.5 rounded-md px-1 py-1 text-left hover:bg-surface-hover"
            onClick={onPress}
        >
            <span className="relative grid size-7 shrink-0 place-items-center rounded-full bg-surface-raised text-text">
                {provider === undefined ? <Icon icon={Bot} size={14} /> : <AgentIcon kind={provider} size={14} />}
                <span className={clsx('absolute -right-0.5 -bottom-0.5 size-2.5 rounded-full ring-2 ring-surface', DOT[state])} />
            </span>
            <span className="flex min-w-0 grow flex-col">
                <span data-find-field="summary" className="truncate text-xs font-medium text-text">
                    {model === null ? title : t('rows.task.named', { model, title })}
                </span>
                <StateLine state={state} task={task} />
            </span>
            {(state === 'running' || state === 'waiting') && startedAt > 0 && <Elapsed startedAt={startedAt} />}
            {settled && startedAt > 0 && finishedAt !== null && finishedAt >= startedAt && (
                <span className="shrink-0 text-xs text-text-faint tabular-nums">{formatElapsedShort(finishedAt - startedAt)}</span>
            )}
            <Icon icon={ChevronRight} size={12} className={clsx('shrink-0 text-text-faint transition-transform', open && 'rotate-90')} />
        </button>
    );
}
