import clsx from 'clsx';
import { isBlock, type TimelineRow } from '../../logic/timeline';

/* Below this distance from the bottom a thread follows what the agent writes; above it the reader scrolled back on purpose. */
export const FOLLOW_THRESHOLD_PX = 40;

/*
 * The gaps a row wears for where it sits: a question is followed by its answer gap, and a seam where
 * the list rhythm of tool lines meets the block rhythm of prose gets the block gap. A question
 * already carries the gap before it, and the row after one is the answer, so neither takes a seam.
 */
export function rowRhythm(row: TimelineRow, previous: TimelineRow | null): string {
    const question = row.kind === 'user';
    const seam = !question && previous !== null && previous.kind !== 'user' && isBlock(row) !== isBlock(previous);
    return clsx(question && 'pb-(--chat-answer-gap)', seam && 'pt-(--chat-block-gap)');
}

/*
 * Whether a reply's header goes over this row, and the time it shows: the first row after the question
 * or the agent's own turn opener, whatever row that is, dated when that turn began. A thread that
 * starts halfway through a reply has no time to show.
 */
export function replyHeader(row: TimelineRow, previous: TimelineRow | null): { at: number | null } | null {
    if (row.kind === 'user' || row.kind === 'turn-start') {
        return null;
    }
    if (previous === null) {
        return { at: null };
    }
    if (previous.kind === 'user') {
        return { at: previous.item.createdAt };
    }
    if (previous.kind === 'turn-start') {
        return { at: previous.turn.createdAt };
    }
    return null;
}
