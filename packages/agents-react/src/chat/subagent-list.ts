import i18next from 'i18next';
import type { ChatItem, ChatSubagentItem } from '@ruimte/agent-contracts';
import { formatMoment } from '@ruimte/ui/format/datetime';
import { formatElapsedShort } from '@ruimte/ui/format/duration';
import type { StatusWord } from '../agents/status-look';
import type { SubagentTask } from '../host';

export const subagentTitle = (item: ChatSubagentItem): string =>
    item.description || item.summary || item.subagentType || i18next.t('agent-chat:rows.subagent.label');

/* The task a row stands for, whose id the host wrote into the row's own. */
export const taskIdOf = (item: ChatSubagentItem): string | null => (item.origin === 'ruimte' && item.id.startsWith('task-') ? item.id.slice(5) : null);

/* A cancelled task is a failed row on the wire and a paused one a running row, and only the task itself still says which it is. */
export const statusWordOf = (item: ChatSubagentItem, task: SubagentTask | null): StatusWord => {
    if (item.status === 'failed' && task?.status === 'cancelled') {
        return 'cancelled';
    }
    if (item.status === 'running' && task?.status === 'open' && task.paused !== undefined) {
        return 'paused';
    }
    return item.status;
};

/*
 * What the flyout over the composer lists: every sub-agent still at work, and the ones that settled
 * since the last message, so a finished batch stays until the next message is sent. That includes an
 * older row a message woke again. A settled one from before that message stays too while a sibling of
 * its turn still runs. Older ones are only in the thread.
 */
export const flyoutSubagents = (order: readonly string[], structure: Readonly<Record<string, ChatItem>>): ChatSubagentItem[] => {
    const lastMessage = order.findLastIndex((id) => structure[id]?.kind === 'user');
    const lastMessageAt = lastMessage < 0 ? null : (structure[order[lastMessage]!]?.createdAt ?? null);
    const items = order.flatMap((id, index) => {
        const item = structure[id];
        return item?.kind === 'subagent' ? [{ item, index }] : [];
    });
    const turns = new Set(items.flatMap(({ item }) => (item.status === 'running' && item.turnId !== null ? [item.turnId] : [])));
    return items
        .filter(
            ({ item, index }) =>
                item.status === 'running' ||
                index > lastMessage ||
                (lastMessageAt !== null && item.finishedAt !== null && item.finishedAt > lastMessageAt) ||
                (item.turnId !== null && turns.has(item.turnId))
        )
        .map(({ item }) => item);
};

/* The one state the badge shows for all of them: work in progress first, then work held up, then whatever went wrong. */
export const summaryWordOf = (words: readonly StatusWord[]): StatusWord =>
    (['running', 'paused', 'failed', 'cancelled'] as const).find((word) => words.includes(word)) ?? 'done';

/* The number on the badge: the ones still at work, a paused one included, and all of them once none is. */
export const badgeCountOf = (words: readonly StatusWord[]): number => {
    const active = words.filter((word) => word === 'running' || word === 'paused').length;
    return active > 0 ? active : words.length;
};

/* The time on the right of an entry: how long it has run so far, or how long it took once it settled. */
export const entryTimeOf = (item: ChatSubagentItem, task: SubagentTask | null, now: number): string => {
    // A task's own record says when it was given and settled; the row copies those, but may lag behind it.
    const startedAt = task?.createdAt ?? item.startedAt;
    const finishedAt = task === null ? item.finishedAt : (task.settledAt ?? item.finishedAt);
    const word = statusWordOf(item, task);
    if (word === 'paused') {
        const until = task?.paused?.until;
        return until === undefined
            ? i18next.t('agent-chat:common.status.paused')
            : i18next.t('agent-chat:activity.pausedUntil', { time: formatMoment(until, now) });
    }
    if (item.status === 'running') {
        return startedAt > 0 ? formatElapsedShort(now - startedAt) : '';
    }
    if (startedAt <= 0 || finishedAt === null || finishedAt < startedAt) {
        return i18next.t(`agent-chat:common.status.${word}`);
    }
    return i18next.t(`agent-chat:activity.took.${word}`, { duration: formatElapsedShort(finishedAt - startedAt) });
};

/*
 * What the Stop of an active entry does: a task stops the node working on it, and a subagent of the
 * CLI's own is only marked stopped, since no CLI stops one on its own. While the chat's turn runs that
 * turn may still wait on it, so stopping the turn (the composer's Stop) is the only offer then.
 */
export type SubagentStop = 'task' | 'mark';

export const stopOf = (item: ChatSubagentItem, turnRunning: boolean): SubagentStop | null => {
    if (item.status !== 'running') {
        return null;
    }
    if (item.origin === 'ruimte') {
        return item.childId === undefined ? null : 'task';
    }
    return turnRunning ? null : 'mark';
};

export const stopLabel = (stop: SubagentStop): string =>
    stop === 'task' ? i18next.t('agent-chat:subagents.stop.task') : i18next.t('agent-chat:subagents.stop.mark');

/*
 * What the composer's Stop does. A plain click stops the turn alone, as it always has; Shift also ends
 * every agent the chat opened and marks its CLI's own sub-agents stopped, which a turn alone leaves running.
 */
export type ComposerStop = 'turn' | 'turn-and-subagents';

export const composerStopOf = (shiftKey: boolean): ComposerStop => (shiftKey ? 'turn-and-subagents' : 'turn');

export const composerStopLabel = (): string => i18next.t('agent-chat:composer.stop');
