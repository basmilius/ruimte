import type { ThreadCard } from '../../host';
import type { TimelineRow } from './timeline';

/*
 * When what a row shows began, or null for a row that only follows the one before it: a turn's
 * changed files and forks, a note, a report. The working row closes the thread, so every card goes
 * above it.
 */
function rowTime(row: TimelineRow): number | null {
    switch (row.kind) {
        case 'user':
        case 'assistant':
        case 'thinking':
        case 'approval':
        case 'question':
        case 'subagent':
            return row.item.createdAt;
        case 'turn-start':
        case 'turn-fold':
            return row.turn.createdAt;
        case 'work':
        case 'work-live':
        case 'workflow':
            return row.tool.createdAt;
        case 'work-group':
            return row.tools[0]?.createdAt ?? null;
        case 'working':
            return Number.POSITIVE_INFINITY;
        default:
            return null;
    }
}

/* Prefixed, so a card never shares a key with a row of the chat's own. */
function cardRow(card: ThreadCard): TimelineRow {
    return { kind: 'app-card', id: `app-card-${card.id}`, card };
}

/*
 * The thread's rows with an app's cards among them: a card goes right before the first row that
 * began after it, so in a folded turn it lands under the fold, and in an open one between its calls.
 * Without cards the rows come back as they are, the same array.
 */
export function withThreadCards(rows: TimelineRow[], cards: readonly ThreadCard[]): TimelineRow[] {
    if (cards.length === 0) {
        return rows;
    }
    // Sorting is stable, so cards of the same moment keep the order the app gave them.
    const pending = [...cards].sort((first, second) => first.at - second.at);
    const merged: TimelineRow[] = [];
    let next = 0;
    for (const row of rows) {
        const time = rowTime(row);
        while (time !== null && next < pending.length && pending[next]!.at < time) {
            merged.push(cardRow(pending[next]!));
            next += 1;
        }
        merged.push(row);
    }
    for (; next < pending.length; next++) {
        merged.push(cardRow(pending[next]!));
    }
    return merged;
}
