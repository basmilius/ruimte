import type {
    ChatApprovalItem,
    ChatAssistantItem,
    ChatCheckpointDiff,
    ChatItem,
    ChatQuestionItem,
    ChatToolItem,
    ChatTurnItem,
    ChatUserItem
} from '@ruimte/contracts';
import { hasFileChanges, isFileChange } from './tools';

/*
 * What the thread shows, row by row. Items are what the daemon knows; rows are what a reader
 * wants: one line per tool call, runs of tool calls folded into a summary, past turns folded
 * behind "Worked for 12s", and the file changes of a turn gathered into one card.
 */
export type TimelineRow =
    | { kind: 'user'; id: string; item: ChatUserItem }
    | { kind: 'assistant'; id: string; item: ChatAssistantItem }
    | { kind: 'work'; id: string; tool: ChatToolItem }
    | { kind: 'work-group'; id: string; tools: ChatToolItem[]; summary: string; expanded: boolean }
    | { kind: 'work-live'; id: string; tool: ChatToolItem }
    | { kind: 'approval'; id: string; item: ChatApprovalItem }
    | { kind: 'question'; id: string; item: ChatQuestionItem }
    | { kind: 'note'; id: string; level: 'info' | 'warning' | 'error'; text: string }
    | { kind: 'compaction'; id: string; preTokens: number | null }
    | { kind: 'changed-files'; id: string; turnId: string; tools: ChatToolItem[]; diff: ChatCheckpointDiff | null; checkpoint: boolean }
    | { kind: 'turn-fold'; id: string; turn: ChatTurnItem; label: string; hiddenCount: number; expanded: boolean }
    | { kind: 'working'; id: string; startedAt: number };

interface TimelineOptions {
    expandedGroups: ReadonlySet<string>;
    expandedTurns: ReadonlySet<string>;
    activeTurnId: string | null;
}

const TOOL_VERBS: Record<string, { verb: string; noun: string }> = {
    Read: { verb: 'Read', noun: 'file' },
    Edit: { verb: 'Edited', noun: 'file' },
    Write: { verb: 'Wrote', noun: 'file' },
    MultiEdit: { verb: 'Edited', noun: 'file' },
    NotebookEdit: { verb: 'Edited', noun: 'notebook' },
    ApplyPatch: { verb: 'Edited', noun: 'file' },
    Bash: { verb: 'Ran', noun: 'command' },
    Grep: { verb: 'Searched', noun: 'pattern' },
    Glob: { verb: 'Listed', noun: 'pattern' },
    WebFetch: { verb: 'Fetched', noun: 'page' },
    WebSearch: { verb: 'Searched the web', noun: 'query' },
    Task: { verb: 'Delegated', noun: 'task' },
    Agent: { verb: 'Delegated', noun: 'task' },
    Skill: { verb: 'Used', noun: 'skill' },
    TodoWrite: { verb: 'Updated', noun: 'plan' }
};

const plural = (count: number, noun: string): string => `${count} ${noun}${count === 1 ? '' : 's'}`;

/* "Read 4 files", "Ran 2 commands", or "12 tool calls" when the run mixes kinds. */
export const summarizeGroup = (tools: ChatToolItem[]): string => {
    const names = new Set(tools.map((tool) => tool.name));
    if (names.size === 1) {
        const name = tools[0]!.name;
        const verb = TOOL_VERBS[name];
        return verb ? `${verb.verb} ${plural(tools.length, verb.noun)}` : `${name} ${plural(tools.length, 'call')}`;
    }
    const edits = tools.filter((tool) => isFileChange(tool.name)).length;
    if (edits === tools.length) {
        return `Edited ${plural(new Set(tools.map((tool) => (tool.input as { file_path?: string })?.file_path ?? tool.id)).size, 'file')}`;
    }
    return plural(tools.length, 'tool call');
};

const formatDuration = (ms: number): string => {
    const seconds = Math.max(1, Math.round(ms / 1000));
    if (seconds < 60) {
        return `${seconds}s`;
    }
    const minutes = Math.floor(seconds / 60);
    const rest = seconds % 60;
    return rest === 0 ? `${minutes}m` : `${minutes}m ${rest}s`;
};

export const turnLabel = (turn: ChatTurnItem): string => {
    const duration = formatDuration((turn.endedAt ?? turn.createdAt) - turn.createdAt);
    switch (turn.state) {
        case 'aborted':
            return `You stopped after ${duration}`;
        case 'error':
            return `Failed after ${duration}`;
        default:
            return `Worked for ${duration}`;
    }
};

// Subagent calls stay inside their Task row; the thread shows the delegation, not its internals.
const isVisibleTool = (tool: ChatToolItem): boolean => tool.parentToolUseId === null;

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

/* Rows for a run of items, in order, with tool runs folded. */
const rowsForItems = (items: ChatItem[], options: TimelineOptions): TimelineRow[] => {
    const rows: TimelineRow[] = [];
    const tools: ChatToolItem[] = [];
    for (const item of items) {
        if (item.kind === 'tool') {
            if (isVisibleTool(item)) {
                tools.push(item);
            }
            continue;
        }
        flushTools(tools, rows, options);
        switch (item.kind) {
            case 'user':
                rows.push({ kind: 'user', id: item.id, item });
                break;
            case 'assistant':
                if (item.text !== '' || item.streaming) {
                    rows.push({ kind: 'assistant', id: item.id, item });
                }
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
                rows.push({ kind: 'note', id: item.id, level: item.level, text: item.text });
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
            rows.push(...rowsForItems(chunk.items, options));
            continue;
        }
        const turnId = chunk.turnId;
        const turn = chunk.items.find((item): item is ChatTurnItem => item.kind === 'turn');
        const user = chunk.items.filter((item) => item.kind === 'user');
        const rest = chunk.items.filter((item) => item.kind !== 'user' && item.kind !== 'turn');
        rows.push(...rowsForItems(user, options));
        const active = turnId === options.activeTurnId || turn?.state === 'running';
        const work = rowsForItems(rest, options);
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
            rows.push({ kind: 'turn-fold', id: `fold-${turnId}`, turn, label: turnLabel(turn), hiddenCount: folded.length, expanded });
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
    }
    return rows;
};
