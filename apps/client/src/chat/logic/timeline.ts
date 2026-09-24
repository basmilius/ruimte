import i18next from 'i18next';
import type {
    ChatApprovalItem,
    ChatAssistantItem,
    ChatCheckpointDiff,
    ChatItem,
    ChatQuestionItem,
    ChatSubagentItem,
    ChatThinkingItem,
    ChatToolItem,
    ChatTurnItem,
    ChatUserItem
} from '@ruimte/contracts';
import { abortedByMachine } from '@ruimte/contracts';
import { formatElapsedShort } from '@/format/duration';
import { handbackReportOf } from './handback';
import { toolEntry } from './tool-catalog';
import { hasFileChanges, isFileChange } from './tools';

/* A subagent's row: the work the thread kept of it, and the agents it opened in turn, each a row of its own under it. */
export interface SubagentBranch {
    id: string;
    item: ChatSubagentItem;
    children: ChatItem[];
    nested: SubagentBranch[];
    expanded: boolean;
}

/*
 * What the thread shows, row by row. Items are what the daemon knows; rows are what a reader
 * wants: one line per tool call, runs of tool calls folded into a summary, past turns folded
 * behind "Worked for 12s" and what the turn did, and the file changes of a turn gathered into one card.
 */
export type TimelineRow =
    | { kind: 'user'; id: string; item: ChatUserItem }
    | { kind: 'turn-start'; id: string; turn: ChatTurnItem; label: string }
    | { kind: 'assistant'; id: string; item: ChatAssistantItem }
    // A subagent's `SubagentHandback` call, drawn as the report it carries rather than as a tool call.
    | { kind: 'report'; id: string; text: string }
    | { kind: 'thinking'; id: string; item: ChatThinkingItem }
    | { kind: 'work'; id: string; tool: ChatToolItem }
    | { kind: 'work-group'; id: string; tools: ChatToolItem[]; summary: string; expanded: boolean }
    | { kind: 'work-live'; id: string; tool: ChatToolItem }
    | ({ kind: 'subagent' } & SubagentBranch)
    | { kind: 'approval'; id: string; item: ChatApprovalItem }
    | { kind: 'question'; id: string; item: ChatQuestionItem }
    | { kind: 'note'; id: string; level: 'info' | 'warning' | 'error'; text: string; from?: string }
    | { kind: 'compaction'; id: string; preTokens: number | null }
    | { kind: 'changed-files'; id: string; turnId: string; tools: ChatToolItem[]; diff: ChatCheckpointDiff | null; checkpoint: boolean }
    | { kind: 'turn-fold'; id: string; turn: ChatTurnItem; label: string; work: string[]; hiddenCount: number; expanded: boolean }
    | { kind: 'forks'; id: string; turnId: string }
    | { kind: 'working'; id: string; startedAt: number };

interface TimelineOptions {
    expandedGroups: ReadonlySet<string>;
    expandedTurns: ReadonlySet<string>;
    expandedSubagents: ReadonlySet<string>;
    activeTurnId: string | null;
    /* The settled turns a fork went on after; a thread that cannot fork leaves it out. */
    forkedTurns?: ReadonlySet<string>;
}

/*
 * A turn runs in two rhythms. The tool lines are a list and read as one when they sit tight
 * against each other; prose and cards are blocks and need room around them. Where the two meet,
 * the block gap marks the seam, so an answer never looks glued to the call above it.
 */
const BLOCK_KINDS = new Set<TimelineRow['kind']>(['assistant', 'report', 'thinking', 'changed-files', 'compaction']);

export const isBlock = (row: TimelineRow): boolean => BLOCK_KINDS.has(row.kind);

/* "Read 4 files", "Ran 2 commands", or "12 tool calls" when the run mixes kinds. */
export const summarizeGroup = (tools: ChatToolItem[]): string => {
    const names = new Set(tools.map((tool) => tool.name));
    const only = names.size === 1 ? tools[0]!.name : null;
    if (only !== null && toolEntry(only)?.grouped === true) {
        return i18next.t(`chat:group.tools.${only}`, { count: tools.length });
    }
    /* A run that only touches files says so once, whether it took one tool or three, and counts the
       files rather than the calls: three edits to one file are one file edited. */
    if (tools.every((tool) => isFileChange(tool.name))) {
        const paths = new Set(tools.map((tool) => (tool.input as { file_path?: string })?.file_path ?? tool.id));
        return i18next.t('chat:group.edited', { count: paths.size });
    }
    if (only !== null) {
        return i18next.t('chat:group.calls', { name: only, count: tools.length });
    }
    return i18next.t('chat:group.toolCalls', { count: tools.length });
};

/*
 * What a folded turn did, a sentence per kind of call in the order it first came: "Read 11 files",
 * "Searched 2 patterns". Every file change reads as one sentence, and calls without a sentence of
 * their own are counted together at the end.
 */
export const summarizeTurn = (tools: readonly ChatToolItem[]): string[] => {
    // Keyed by the sentence, so its place is where the first call of that kind came.
    const counts = new Map<string, number>();
    const edited = new Set<string>();
    let other = 0;
    for (const tool of tools) {
        if (isFileChange(tool.name)) {
            edited.add((tool.input as { file_path?: string })?.file_path ?? tool.id);
            counts.set('chat:group.edited', edited.size);
        } else if (toolEntry(tool.name)?.grouped === true) {
            const key = `chat:group.tools.${tool.name}`;
            counts.set(key, (counts.get(key) ?? 0) + 1);
        } else {
            other += 1;
        }
    }
    const parts = [...counts].map(([key, count]) => i18next.t(key, { count }));
    if (other > 0) {
        parts.push(i18next.t(parts.length === 0 ? 'chat:group.toolCalls' : 'chat:group.otherCalls', { count: other }));
    }
    return parts;
};

/*
 * What a turn nobody asked for is about. The CLI wakes the agent when a background subagent settles
 * and hands over its summary; without one all that is known is that the agent went on by itself.
 */
export const agentTurnLabel = (turn: ChatTurnItem): string => {
    const about = (what: string): string => (turn.label ? i18next.t('chat:turn.about', { what, label: turn.label }) : what);
    // A turn the machine opened with the results of tasks this chat gave; the label is their titles.
    if (turn.taskIds !== undefined && turn.taskIds.length > 0) {
        return about(i18next.t('chat:turn.wokenByTask', { count: turn.taskIds.length }));
    }
    // A turn the machine opened over a message another node sent; the label names who sent it.
    if (turn.messageFrom !== undefined && turn.messageFrom.length > 0) {
        return about(i18next.t('chat:turn.wokenByMessage', { count: turn.messageFrom.length }));
    }
    return turn.label ? i18next.t('chat:turn.subagentFinished', { label: turn.label }) : i18next.t('chat:turn.continued');
};

/* The items of the turn tell a turn a person stopped from one the machine ended after a restart. */
export const turnLabel = (turn: ChatTurnItem, items: readonly ChatItem[] = []): string => {
    const duration = formatElapsedShort((turn.endedAt ?? turn.createdAt) - turn.createdAt);
    switch (turn.state) {
        case 'aborted':
            return abortedByMachine(turn, items) ? i18next.t('chat:turn.stopped', { duration }) : i18next.t('chat:turn.youStopped', { duration });
        case 'error':
            return i18next.t('chat:turn.failed', { duration });
        default:
            return i18next.t('chat:turn.worked', { duration });
    }
};

// A subagent's own work, and an agent it opened, belong to its row, not to the thread; an old record has no row for it.
const parentOf = (item: ChatItem): string | null =>
    item.kind === 'tool' || item.kind === 'assistant' || item.kind === 'subagent' ? (item.parentToolUseId ?? null) : null;

// Deeper than the CLI forwards any call; it also ends a chain of rows that would name each other.
const MAX_NESTING = 8;

const branchOf = (item: ChatSubagentItem, options: TimelineOptions, children: Map<string, ChatItem[]>, depth = 0): SubagentBranch => {
    const own = children.get(item.toolUseId) ?? [];
    return {
        id: item.id,
        item,
        children: own.filter((child) => child.kind !== 'subagent'),
        nested:
            depth >= MAX_NESTING
                ? []
                : own.filter((child): child is ChatSubagentItem => child.kind === 'subagent').map((child) => branchOf(child, options, children, depth + 1)),
        expanded: options.expandedSubagents.has(item.id)
    };
};

/* The branch a subagent's row sits in, its own or one it hangs under, anywhere in the thread's rows. */
export const findSubagentBranch = (rows: readonly TimelineRow[], toolUseId: string): { index: number; branch: SubagentBranch } | null => {
    const search = (branch: SubagentBranch): SubagentBranch | null => {
        if (branch.item.toolUseId === toolUseId) {
            return branch;
        }
        for (const child of branch.nested) {
            const found = search(child);
            if (found) {
                return found;
            }
        }
        return null;
    };
    for (let index = 0; index < rows.length; index++) {
        const row = rows[index]!;
        const branch = row.kind === 'subagent' ? search(row) : null;
        if (branch) {
            return { index, branch };
        }
    }
    return null;
};

/* What each subagent did, keyed by the call that spawned it, in the order it happened. */
const groupChildren = (items: ChatItem[]): Map<string, ChatItem[]> => {
    const children = new Map<string, ChatItem[]>();
    for (const item of items) {
        const parent = parentOf(item);
        if (parent === null) {
            continue;
        }
        const bucket = children.get(parent);
        if (bucket) {
            bucket.push(item);
        } else {
            children.set(parent, [item]);
        }
    }
    return children;
};

const flushTools = (buffer: ChatToolItem[], rows: TimelineRow[], options: TimelineOptions): void => {
    if (buffer.length === 0) {
        return;
    }
    const tools = buffer.splice(0);
    const live = tools.filter((tool) => tool.state === 'running');
    const settled = tools.filter((tool) => tool.state !== 'running');
    if (settled.length === 1) {
        rows.push({ kind: 'work', id: settled[0]!.id, tool: settled[0]! });
    } else if (settled.length > 1) {
        const id = `group-${settled[0]!.id}`;
        const expanded = options.expandedGroups.has(id);
        rows.push({ kind: 'work-group', id, tools: settled, summary: summarizeGroup(settled), expanded });
        if (expanded) {
            for (const tool of settled) {
                rows.push({ kind: 'work', id: tool.id, tool });
            }
        }
    }
    for (const tool of live) {
        rows.push({ kind: 'work-live', id: tool.id, tool });
    }
};

/* Rows for a run of items, in order, with tool runs folded and a subagent's work under its own row. */
const rowsForItems = (items: ChatItem[], options: TimelineOptions, children: Map<string, ChatItem[]>): TimelineRow[] => {
    const rows: TimelineRow[] = [];
    const tools: ChatToolItem[] = [];
    for (const item of items) {
        if (parentOf(item) !== null) {
            continue;
        }
        const report = handbackReportOf(item);
        if (item.kind === 'tool' && report === null) {
            tools.push(item);
            continue;
        }
        if (report !== null) {
            flushTools(tools, rows, options);
            rows.push({ kind: 'report', id: item.id, text: report });
            continue;
        }
        flushTools(tools, rows, options);
        switch (item.kind) {
            case 'subagent':
                rows.push({ kind: 'subagent', ...branchOf(item, options, children) });
                break;
            case 'user':
                rows.push({ kind: 'user', id: item.id, item });
                break;
            case 'assistant':
                if (item.text !== '' || item.streaming) {
                    rows.push({ kind: 'assistant', id: item.id, item });
                }
                break;
            case 'thinking':
                rows.push({ kind: 'thinking', id: item.id, item });
                break;
            case 'approval':
                // A pending one sits on the composer; only its outcome belongs in the transcript.
                if (item.decision !== 'pending') {
                    rows.push({ kind: 'approval', id: item.id, item });
                }
                break;
            case 'question':
                if (item.state !== 'pending') {
                    rows.push({ kind: 'question', id: item.id, item });
                }
                break;
            case 'note':
                rows.push({ kind: 'note', id: item.id, level: item.level, text: item.text, ...(item.from === undefined ? {} : { from: item.from }) });
                break;
            case 'compaction':
                rows.push({ kind: 'compaction', id: item.id, preTokens: item.preTokens });
                break;
            case 'turn':
                break;
        }
    }
    flushTools(tools, rows, options);
    return rows;
};

/* The card of a settled turn: the checkpoint diff when the daemon took one, else what the tool calls carry. */
const changedFilesRow = (turn: ChatTurnItem, items: ChatItem[]): TimelineRow | null => {
    const edits = items.filter(
        (item): item is ChatToolItem => item.kind === 'tool' && item.state === 'done' && isFileChange(item.name) && hasFileChanges(item)
    );
    const diff = turn.checkpointDiff ?? null;
    const empty = diff === null ? edits.length === 0 : diff.files.length === 0;
    if (empty) {
        return null;
    }
    return { kind: 'changed-files', id: `files-${turn.id}`, turnId: turn.id, tools: edits, diff, checkpoint: turn.checkpoint !== undefined };
};

const lastAssistantRow = (rows: TimelineRow[]): TimelineRow | null => {
    for (let i = rows.length - 1; i >= 0; i--) {
        const row = rows[i]!;
        if (row.kind === 'assistant') {
            return row;
        }
        if (row.kind !== 'note') {
            return null;
        }
    }
    return null;
};

/* The whole thread as rows; items without a turn (older records) are shown as they are. */
export const deriveTimelineRows = (items: ChatItem[], options: TimelineOptions): TimelineRow[] => {
    const rows: TimelineRow[] = [];
    const children = groupChildren(items);
    // Items are grouped by turn, in order of first appearance; runs of turnless items keep their place.
    const chunks: Array<{ turnId: string | null; items: ChatItem[] }> = [];
    const byTurn = new Map<string, ChatItem[]>();
    for (const item of items) {
        if (item.turnId === null) {
            const last = chunks[chunks.length - 1];
            if (last && last.turnId === null) {
                last.items.push(item);
            } else {
                chunks.push({ turnId: null, items: [item] });
            }
            continue;
        }
        let bucket = byTurn.get(item.turnId);
        if (!bucket) {
            bucket = [];
            byTurn.set(item.turnId, bucket);
            chunks.push({ turnId: item.turnId, items: bucket });
        }
        bucket.push(item);
    }

    for (const chunk of chunks) {
        if (chunk.turnId === null) {
            rows.push(...rowsForItems(chunk.items, options, children));
            continue;
        }
        const turnId = chunk.turnId;
        const turn = chunk.items.find((item): item is ChatTurnItem => item.kind === 'turn');
        const user = chunk.items.filter((item) => item.kind === 'user');
        const rest = chunk.items.filter((item) => item.kind !== 'user' && item.kind !== 'turn');
        if (turn?.origin === 'agent') {
            // The agent started this one itself, so there is no message of the person to show above it.
            rows.push({ kind: 'turn-start', id: `start-${turnId}`, turn, label: agentTurnLabel(turn) });
        }
        rows.push(...rowsForItems(user, options, children));
        const active = turnId === options.activeTurnId || turn?.state === 'running';
        const work = rowsForItems(rest, options, children);
        if (!turn || active) {
            rows.push(...work);
            if (active) {
                rows.push({ kind: 'working', id: `working-${turnId}`, startedAt: turn?.createdAt ?? Date.now() });
            }
            continue;
        }
        // The closing answer stays visible; everything before it folds behind the label.
        const finalAssistant = lastAssistantRow(work);
        const folded = finalAssistant ? work.slice(0, work.indexOf(finalAssistant)) : work;
        const expanded = options.expandedTurns.has(turnId);
        if (folded.length > 0) {
            const tools = rest.filter((item): item is ChatToolItem => item.kind === 'tool' && parentOf(item) === null && handbackReportOf(item) === null);
            rows.push({
                kind: 'turn-fold',
                id: `fold-${turnId}`,
                turn,
                label: turnLabel(turn, chunk.items),
                work: summarizeTurn(tools),
                hiddenCount: folded.length,
                expanded
            });
            if (expanded) {
                rows.push(...folded);
            }
        }
        const changed = changedFilesRow(turn, rest);
        if (changed) {
            rows.push(changed);
        }
        if (finalAssistant) {
            rows.push(finalAssistant);
        }
        if (options.forkedTurns?.has(turnId) === true) {
            rows.push({ kind: 'forks', id: `forks-${turnId}`, turnId });
        }
    }
    return rows;
};
