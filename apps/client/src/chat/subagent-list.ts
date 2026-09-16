import { CircleCheck, CircleSlash, CircleX, LoaderCircle, type LucideIcon } from 'lucide-react';
import type { ChatItem, ChatSubagentItem, Task } from '@ruimte/contracts';
import { isHandbackNotice, lastHandbackReport } from '@/chat/logic/handback';
import { formatElapsed } from '@/chat/logic/tools';
import { stripMarkdown } from '@/chat/logic/timeline-copy';
import { toolSummary } from '@/chat/logic/tools';
import { canOpenSubagent } from '@/chat/subagent-view';
import { formatClock, formatDate } from '@/shell/usage/format';

/* The latest thing a sub-agent did, as its entry in the list says it: a tool call, or text it wrote. */
export type SubagentPreview = { kind: 'tool'; name: string; detail: string } | { kind: 'text'; text: string };

export type SubagentStatusWord = 'running' | 'done' | 'failed' | 'cancelled';

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

export const subagentTitle = (item: ChatSubagentItem): string => item.description || item.summary || item.subagentType || 'Sub-agent';

/* The task a row stands for, whose id the daemon wrote into the row's own. */
export const taskIdOf = (item: ChatSubagentItem): string | null => (item.origin === 'ruimte' && item.id.startsWith('task-') ? item.id.slice(5) : null);

/* A cancelled task is a failed row on the wire, and only the task itself still says which it was. */
export const statusWordOf = (item: ChatSubagentItem, task: Task | null): SubagentStatusWord =>
    item.status === 'failed' && task?.status === 'cancelled' ? 'cancelled' : item.status;

/* How an entry's state looks in front of its title. */
export interface SubagentStatusLook {
    icon: LucideIcon;
    tone: string;
    spins: boolean;
}

/*
 * The same states look the same elsewhere: a failed or cancelled task on its node (`TaskMark`), what
 * finished in the toolbar (`StatusSummary`) and work in progress in a toast. A spinner stops under
 * reduced motion with every other animation (`styles.css`).
 */
const STATUS_LOOKS: Record<SubagentStatusWord, SubagentStatusLook> = {
    running: { icon: LoaderCircle, tone: 'text-status-running', spins: true },
    done: { icon: CircleCheck, tone: 'text-status-idle', spins: false },
    failed: { icon: CircleX, tone: 'text-status-error', spins: false },
    cancelled: { icon: CircleSlash, tone: 'text-text-faint', spins: false }
};

export const statusLookOf = (word: SubagentStatusWord): SubagentStatusLook => STATUS_LOOKS[word];

export const previewOfItem = (item: ChatItem): SubagentPreview | null => {
    switch (item.kind) {
        case 'tool':
            return { kind: 'tool', name: item.name, detail: oneLine(toolSummary(item.name, item.input) || item.progress?.description || '') };
        case 'assistant': {
            const text = prose(item.text);
            return text === '' ? null : { kind: 'text', text };
        }
        case 'subagent':
            return { kind: 'tool', name: item.origin === 'ruimte' ? 'Task' : 'Agent', detail: oneLine(item.description) };
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

export const stopLabel = (stop: SubagentStop): string =>
    stop === 'task' ? 'Stop this task' : "Mark as stopped. The CLI cannot stop one sub-agent, so it may keep working until the chat's process ends.";

const HOUR_MS = 3_600_000;

/* How long an entry has run: the same seconds and minutes a running tool call shows, and hours past one. */
export const formatRunningFor = (ms: number): string => {
    if (ms < HOUR_MS) {
        return formatElapsed(ms);
    }
    const hours = Math.floor(ms / HOUR_MS);
    const minutes = Math.floor((ms % HOUR_MS) / 60_000);
    return minutes === 0 ? `${hours}h` : `${hours}h ${minutes}m`;
};

const sameDay = (a: number, b: number): boolean => {
    const left = new Date(a);
    const right = new Date(b);
    return left.getFullYear() === right.getFullYear() && left.getMonth() === right.getMonth() && left.getDate() === right.getDate();
};

/* The time on the right of an entry: how long it has run so far, or when it ended, with the date once that was not today. */
export const entryTimeOf = (item: ChatSubagentItem, task: Task | null, now: number): string | null => {
    // A task's own record says when it was given and settled; the row copies those, but may lag behind it.
    const startedAt = task?.createdAt ?? item.startedAt;
    const finishedAt = task === null ? item.finishedAt : (task.settledAt ?? item.finishedAt);
    if (item.status === 'running') {
        return startedAt > 0 ? formatRunningFor(now - startedAt) : null;
    }
    if (finishedAt === null || finishedAt <= 0) {
        return null;
    }
    return sameDay(finishedAt, now) ? formatClock(finishedAt) : `${formatDate(finishedAt)} ${formatClock(finishedAt)}`;
};
