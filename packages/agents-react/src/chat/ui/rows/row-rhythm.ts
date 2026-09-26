import clsx from 'clsx';
import { isBlock, type TimelineRow } from '../../logic/timeline';

/* Below this distance from the bottom a thread follows what the agent writes; above it the reader scrolled back on purpose. */
export const FOLLOW_THRESHOLD_PX = 40;

/*
 * The gaps a row wears for where it sits: a question is followed by its answer gap, and a seam where
 * the list rhythm of tool lines meets the block rhythm of prose gets the block gap. A question
 * already carries the gap before it, and the row after one is the answer, so neither takes a seam.
 */
export const rowRhythm = (row: TimelineRow, previous: TimelineRow | null): string => {
    const question = row.kind === 'user';
    const seam = !question && previous !== null && previous.kind !== 'user' && isBlock(row) !== isBlock(previous);
    return clsx(question && 'pb-(--chat-answer-gap)', seam && 'pt-(--chat-block-gap)');
};
