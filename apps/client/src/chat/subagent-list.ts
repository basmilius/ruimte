import i18next from 'i18next';
import type { ChatItem, ChatSubagentItem, Task } from '@ruimte/contracts';
import { isHandbackNotice, lastHandbackReport } from '@/chat/logic/handback';
import { stripMarkdown } from '@/chat/logic/timeline-copy';
import { toolSummary } from '@/chat/logic/tools';
import { canOpenSubagent } from '@/chat/subagent-view';
import { formatMoment } from '@/format/datetime';
import { formatElapsedShort } from '@/format/duration';
import type { StatusWord } from '@/ui/status-look';

/* The latest thing a sub-agent did, as its entry in the list says it: a tool call, or text it wrote. */
export type SubagentPreview = { kind: 'tool'; name: string; detail: string } | { kind: 'text'; text: string };

export interface SubagentSections {
    active: ChatSubagentItem[];
    done: ChatSubagentItem[];
}

// An entry shows two lines at most, so a report of many kilobytes is never flattened whole.
const PREVIEW_CHARS = 400;

const oneLine = (text: string): string => text.slice(0, PREVIEW_CHARS).replace(/\s+/g, ' ').trim();

/* A reply is markdown, and the entry draws it as the plain text the thread would render it to. */
const prose = (text: string): string => oneLine(stripMarkdown(text.slice(0, PREVIEW_CHARS)));

/* When an entry last moved: the latest step the thread kept of a running one, else its start; the end of a settled one. */
const updatedAt = (item: ChatSubagentItem, work: readonly ChatItem[]): number | null => {
    if (item.status !== 'running') {
        return item.finishedAt !== null && item.finishedAt > 0 ? item.finishedAt : null;
    }
    const latest = work.reduce((newest, step) => Math.max(newest, step.createdAt), 0);
    const at = Math.max(latest, item.startedAt);
    return at > 0 ? at : null;
};

/* Newest first; an entry that knows no time goes below the rest, in the order the thread has them. */
const newestFirst = (items: ChatSubagentItem[], work: ReadonlyMap<string, readonly ChatItem[]>): ChatSubagentItem[] => {
    const timed = items.map((item, index) => ({ item, index, at: updatedAt(item, work.get(item.toolUseId) ?? []) }));
    timed.sort((left, right) => {
        if (left.at === null || right.at === null) {
            return left.at === right.at ? left.index - right.index : left.at === null ? 1 : -1;
        }
        return right.at - left.at || left.index - right.index;
    });
    return timed.map((entry) => entry.item);
};

/* Running on top and everything that settled below it, the most recently updated first in each. */
export const sectionSubagents = (items: readonly ChatSubagentItem[], work: ReadonlyMap<string, readonly ChatItem[]> = new Map()): SubagentSections => ({
    active: newestFirst(
        items.filter((item) => item.status === 'running'),
        work
    ),
    done: newestFirst(
        items.filter((item) => item.status !== 'running'),
        work
    )
});

export const subagentTitle = (item: ChatSubagentItem): string => item.description || item.summary || item.subagentType || i18next.t('chat:rows.subagent.label');

/* The task a row stands for, whose id the daemon wrote into the row's own. */
export const taskIdOf = (item: ChatSubagentItem): string | null => (item.origin === 'ruimte' && item.id.startsWith('task-') ? item.id.slice(5) : null);

/* A cancelled task is a failed row on the wire, and only the task itself still says which it was. */
export const statusWordOf = (item: ChatSubagentItem, task: Task | null): StatusWord =>
    item.status === 'failed' && task?.status === 'cancelled' ? 'cancelled' : item.status;

export const previewOfItem = (item: ChatItem): SubagentPreview | null => {
    switch (item.kind) {
        case 'tool':
            return { kind: 'tool', name: item.name, detail: oneLine(toolSummary(item.name, item.input) || item.progress?.description || '') };
        case 'assistant': {
            const text = prose(item.text);
            return text === '' ? null : { kind: 'text', text };
        }
        case 'subagent':
            return {
                kind: 'tool',
                name: item.origin === 'ruimte' ? i18next.t('chat:rows.subagent.task') : i18next.t('chat:rows.reply.agent'),
                detail: oneLine(item.description)
            };
        default:
            return null;
    }
};

export const latestPreview = (items: readonly ChatItem[]): SubagentPreview | null => {
    for (let i = items.length - 1; i >= 0; i--) {
        const preview = previewOfItem(items[i]!);
        if (preview !== null) {
            return preview;
        }
    }
    return null;
};

/* What of every sub-agent's own work the parent's thread kept, by the call that opened it, in thread order. */
export const threadWorkBy = (order: readonly string[], structure: Record<string, ChatItem>): Map<string, ChatItem[]> => {
    const work = new Map<string, ChatItem[]>();
    for (const id of order) {
        const item = structure[id];
        if ((item?.kind === 'tool' || item?.kind === 'assistant') && item.parentToolUseId) {
            const list = work.get(item.parentToolUseId) ?? [];
            list.push(item);
            work.set(item.parentToolUseId, list);
        }
    }
    return work;
};

/* The thread kept the beginning of a sub-agent that did too much, so only a thread that kept all of it has the latest. */
const threadHasLatest = (item: ChatSubagentItem, work: readonly ChatItem[]): boolean => !item.itemsTruncated && work.length > 0;

/*
 * Whether the list reads the newest end of the conversation from the machine: only for a sub-agent
 * still at work whose latest step the parent's thread does not hold, which is a task (its work is
 * in another node's thread), a Codex agent, and a Claude agent past what the thread keeps.
 */
export const needsTail = (item: ChatSubagentItem, work: readonly ChatItem[], machineRefused: boolean): boolean =>
    (item.status === 'running' || reportIsNotice(item, work)) && !threadHasLatest(item, work) && canOpenSubagent(item, machineRefused);

/* A settled agent whose only word is the notice that its report went elsewhere, with no handed-back report to show. */
const reportIsNotice = (item: ChatSubagentItem, work: readonly ChatItem[]): boolean =>
    lastHandbackReport(work) === null && isHandbackNotice(item.result ?? item.summary);

export const previewFor = (item: ChatSubagentItem, work: readonly ChatItem[], tail: readonly ChatItem[] | null): SubagentPreview | null => {
    const fromThread = threadHasLatest(item, work) ? latestPreview(work) : null;
    if (item.status === 'running') {
        const latest = fromThread ?? (tail === null ? null : latestPreview(tail));
        if (latest !== null) {
            return latest;
        }
        if (item.lastTool) {
            return { kind: 'tool', name: item.lastTool, detail: oneLine(item.summary ?? '') };
        }
        return item.summary ? { kind: 'text', text: oneLine(item.summary) } : null;
    }
    // A report handed back with `SubagentHandback` is the real one; the result then only says where it went.
    const handedBack = lastHandbackReport(work) ?? (tail === null ? null : lastHandbackReport(tail));
    if (handedBack !== null) {
        return { kind: 'text', text: prose(handedBack) };
    }
    // Whatever it wrote last before it settled is the report the row keeps.
    const notice = isHandbackNotice(item.result ?? item.summary);
    const report = notice ? '' : prose(item.result ?? '');
    if (report !== '') {
        return { kind: 'text', text: report };
    }
    // Only a notice sends the entry to the conversation's newest end for its last real step.
    const latest = fromThread ?? (notice && tail !== null ? latestPreview(tail) : null);
    return latest ?? (item.summary && !isHandbackNotice(item.summary) ? { kind: 'text', text: oneLine(item.summary) } : null);
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

export const stopLabel = (stop: SubagentStop): string => (stop === 'task' ? i18next.t('chat:subagents.stop.task') : i18next.t('chat:subagents.stop.mark'));

/* The time on the right of an entry: how long it has run so far, or when it ended, with the date once that was not today. */
export const entryTimeOf = (item: ChatSubagentItem, task: Task | null, now: number): string | null => {
    // A task's own record says when it was given and settled; the row copies those, but may lag behind it.
    const startedAt = task?.createdAt ?? item.startedAt;
    const finishedAt = task === null ? item.finishedAt : (task.settledAt ?? item.finishedAt);
    if (item.status === 'running') {
        return startedAt > 0 ? formatElapsedShort(now - startedAt) : null;
    }
    if (finishedAt === null || finishedAt <= 0) {
        return null;
    }
    return formatMoment(finishedAt, now);
};

/*
 * What the composer's Stop does. A plain click stops the turn alone, as it always has; Shift also ends
 * every agent the chat opened and marks its CLI's own sub-agents stopped, which a turn alone leaves running.
 */
export type ComposerStop = 'turn' | 'turn-and-subagents';

export const composerStopOf = (shiftKey: boolean): ComposerStop => (shiftKey ? 'turn-and-subagents' : 'turn');

export const composerStopLabel = (): string => i18next.t('chat:composer.stop');
