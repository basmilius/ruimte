import type { ChatItem } from '@ruimte/contracts';
import { compileFind, matchesIn, MATCH_LIMIT, type FindQuery } from '@/find/query';
import { handbackReportOf } from './handback';
import type { TimelineRow } from './timeline';
import { toolSummary } from './tools';

/*
 * Find in a chat, over the thread's data and not its DOM: the timeline only draws the rows on screen,
 * and a folded turn or a closed tool call draws none of what it holds. A row marks each part it draws
 * with `data-find-field`, and the n-th match there is the n-th hit of that field.
 */

/* The line that always shows, the text of a message, or what shows only once a row is opened. */
export type ChatFindField = 'summary' | 'text' | 'output';

export interface ChatHit {
    itemId: string;
    field: ChatFindField;
    /* Which match of that field this is, from zero. */
    occurrence: number;
}

export interface ChatSearch {
    hits: ChatHit[];
    invalid: boolean;
}

const NOTHING: ChatSearch = { hits: [], invalid: false };

/* A sub-agent's own steps belong to its row, which the thread keeps shut; they are its business. */
const isChild = (item: ChatItem): boolean => (item.kind === 'tool' || item.kind === 'assistant') && Boolean(item.parentToolUseId);

/* What a reader can find in an item, part by part, in the order its row draws them. */
export const findableFields = (item: ChatItem): { field: ChatFindField; text: string }[] => {
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
            return [
                { field: 'summary', text: toolSummary(item.name, item.input) },
                { field: 'output', text: item.output ?? '' }
            ];
        }
        case 'note': {
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
};

/* Every hit in the items, in their order. */
export const searchChat = (items: readonly ChatItem[], query: FindQuery): ChatSearch => {
    const compiled = compileFind(query);
    if (compiled.kind === 'empty') {
        return NOTHING;
    }
    if (compiled.kind === 'invalid') {
        return { hits: [], invalid: true };
    }
    const hits: ChatHit[] = [];
    for (const item of items) {
        for (const { field, text } of findableFields(item)) {
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
};

export const hitKey = (hit: ChatHit): string => `${hit.itemId}:${hit.field}:${hit.occurrence}`;

/* What stands between a hit and the screen: its row, a run of tool calls to open, or a turn to unfold. */
export type HitPlace = { kind: 'row'; index: number } | { kind: 'group'; id: string } | { kind: 'turn'; turnId: string } | null;

export interface RowIndex {
    /* The row an item is drawn in, or the closed run of tool calls it is in. */
    rows: Map<string, number>;
    /* The fold of each settled turn. */
    folds: Map<string, number>;
}

export const indexRows = (rows: readonly TimelineRow[]): RowIndex => {
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
};

/* The row a hit is shown at, as the thread stands; -1 for an item the thread draws nowhere. */
export const hitRow = (index: RowIndex, item: ChatItem | undefined): number => {
    if (item === undefined) {
        return -1;
    }
    return index.rows.get(item.id) ?? (item.turnId === null ? undefined : index.folds.get(item.turnId)) ?? -1;
};

export const placeOfHit = (rows: readonly TimelineRow[], index: RowIndex, item: ChatItem | undefined): HitPlace => {
    if (item === undefined) {
        return null;
    }
    const own = index.rows.get(item.id);
    if (own !== undefined) {
        const row = rows[own]!;
        return row.kind === 'work-group' ? { kind: 'group', id: row.id } : { kind: 'row', index: own };
    }
    return item.turnId !== null && index.folds.has(item.turnId) ? { kind: 'turn', turnId: item.turnId } : null;
};
