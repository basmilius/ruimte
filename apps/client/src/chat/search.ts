import type { ChatItem } from '@ruimte/contracts';
import { compileFind, matchesIn, MATCH_LIMIT, type FindQuery } from '@adecore/editor-react/models';
import type { CommandName } from '@adecore/agents-react';
import { handbackReportOf, matchCommandLook, toolSummary, stripAnsi } from '@adecore/agents-react/chat';
import type { TimelineRow } from '@adecore/agents-react/chat';
import type { ChatFindField } from '@adecore/agents-react/chat/ui';
import { RUIMTE_COMMAND_LOOKS } from '@/chat/ruimte-command-look';

/*
 * Find in a chat, over the thread's data and not its DOM: the timeline only draws the rows on screen,
 * and a folded turn or a closed tool call draws none of what it holds. A row marks each part it draws
 * with `data-find-field`, and the n-th match there is the n-th hit of that field.
 */

export interface ChatHit {
    itemId: string;
    field: ChatFindField;
    /* Which match of that field this is, from zero. */
    occurrence: number;
}

interface ChatSearch {
    hits: ChatHit[];
    invalid: boolean;
}

export const NOTHING: ChatSearch = { hits: [], invalid: false };

/* A sub-agent's own steps, and the agents it opened, belong to its row, which the thread keeps shut; they are its business. */
function isChild(item: ChatItem): boolean {
    return (item.kind === 'tool' || item.kind === 'assistant' || item.kind === 'subagent') && Boolean(item.parentToolUseId);
}

/* The title a word of a `ruimte-context` call is drawn as, or null for one drawn as it was typed. */
type CallNames = (word: string, option: string | null) => CommandName | null;

/*
 * The line of a `ruimte-context` call as its row draws it: the detail, a named word as its title with
 * the id behind it, the way the frame holds both. Null for any other call.
 */
function contextCallLine(item: Extract<ChatItem, { kind: 'tool' }>, nameOf: CallNames | undefined): string | null {
    const input = item.input as { command?: unknown } | null;
    const command = item.name === 'Bash' && typeof input?.command === 'string' ? input.command : null;
    const run = command === null ? null : matchCommandLook(command, RUIMTE_COMMAND_LOOKS);
    if (run === null) {
        return null;
    }
    let line = '';
    let at = 0;
    for (const word of run.words) {
        const named = nameOf?.(word.text, word.option) ?? null;
        if (named !== null) {
            line += `${run.detail.slice(at, word.start)}${named.name}${word.text}`;
            at = word.end;
        }
    }
    return line + run.detail.slice(at);
}

/* What a reader can find in an item, part by part, in the order its row draws them. */
function findableFields(item: ChatItem, nameOf?: CallNames, hideTools = false): { field: ChatFindField; text: string }[] {
    if (isChild(item)) {
        return [];
    }
    switch (item.kind) {
        case 'user':
        case 'assistant':
        case 'thinking':
            return [{ field: 'text', text: item.text }];
        case 'tool': {
            const report = handbackReportOf(item);
            if (report !== null) {
                return [{ field: 'text', text: report }];
            }
            // A thread that hides its tool lines draws none of this, so a hit here would lead nowhere.
            if (hideTools) {
                return [];
            }
            return [
                { field: 'summary', text: contextCallLine(item, nameOf) ?? toolSummary(item.name, item.input) },
                { field: 'output', text: stripAnsi(item.output ?? '') }
            ];
        }
        case 'note': {
            // A message or what Ruimte told the agent is drawn as a bubble, which folds as a whole.
            if (item.message !== undefined) {
                return [{ field: 'text', text: item.message.text }];
            }
            if (item.said) {
                return [{ field: 'text', text: item.text }];
            }
            // A note shows its first line and folds the rest.
            const breakAt = item.text.indexOf('\n');
            return breakAt === -1
                ? [{ field: 'summary', text: item.text }]
                : [
                      { field: 'summary', text: item.text.slice(0, breakAt) },
                      { field: 'output', text: item.text.slice(breakAt + 1).trim() }
                  ];
        }
        case 'subagent':
            return [
                { field: 'summary', text: item.description || item.summary || item.subagentType || '' },
                { field: 'output', text: item.result ?? '' }
            ];
        default:
            return [];
    }
}

export function searchChat(items: readonly ChatItem[], query: FindQuery, nameOf?: CallNames, hideTools = false): ChatSearch {
    const compiled = compileFind(query);
    if (compiled.kind === 'empty') {
        return NOTHING;
    }
    if (compiled.kind === 'invalid') {
        return { hits: [], invalid: true };
    }
    const hits: ChatHit[] = [];
    for (const item of items) {
        for (const { field, text } of findableFields(item, nameOf, hideTools)) {
            if (text === '') {
                continue;
            }
            const matches = matchesIn(text, compiled.pattern, MATCH_LIMIT - hits.length);
            for (let occurrence = 0; occurrence < matches.length; occurrence++) {
                hits.push({ itemId: item.id, field, occurrence });
            }
            if (hits.length >= MATCH_LIMIT) {
                return { hits, invalid: false };
            }
        }
    }
    return { hits, invalid: false };
}

export function hitKey(hit: ChatHit): string {
    return `${hit.itemId}:${hit.field}:${hit.occurrence}`;
}

/* What stands between a hit and the screen: its row, a run of tool calls to open, or a turn to unfold. */
type HitPlace = { kind: 'row'; index: number } | { kind: 'group'; id: string } | { kind: 'turn'; turnId: string } | null;

interface RowIndex {
    /* The row an item is drawn in, or the closed run of tool calls it is in. */
    rows: Map<string, number>;
    /* The fold of each settled turn. */
    folds: Map<string, number>;
}

export function indexRows(rows: readonly TimelineRow[]): RowIndex {
    const byItem = new Map<string, number>();
    const folds = new Map<string, number>();
    rows.forEach((row, index) => {
        if (row.kind === 'work-group' && !row.expanded) {
            for (const tool of row.tools) {
                byItem.set(tool.id, index);
            }
        } else if (row.kind === 'turn-fold') {
            folds.set(row.turn.id, index);
        } else {
            byItem.set(row.id, index);
        }
    });
    return { rows: byItem, folds };
}

/* The row a hit is shown at, as the thread stands; -1 for an item the thread draws nowhere. */
export function hitRow(index: RowIndex, item: ChatItem | undefined): number {
    if (item === undefined) {
        return -1;
    }
    return index.rows.get(item.id) ?? (item.turnId === null ? undefined : index.folds.get(item.turnId)) ?? -1;
}

export function placeOfHit(rows: readonly TimelineRow[], index: RowIndex, item: ChatItem | undefined): HitPlace {
    if (item === undefined) {
        return null;
    }
    const own = index.rows.get(item.id);
    if (own !== undefined) {
        const row = rows[own]!;
        return row.kind === 'work-group' ? { kind: 'group', id: row.id } : { kind: 'row', index: own };
    }
    return item.turnId !== null && index.folds.has(item.turnId) ? { kind: 'turn', turnId: item.turnId } : null;
}
