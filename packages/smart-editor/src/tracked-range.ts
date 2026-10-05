import type { DocumentChange } from '@ruimte/smart-editor-core';

/*
 * Where a tracked range is after a batch of changes, or null once a change touched it. A change
 * touches a range when it replaces any of the text inside it or inserts strictly between its ends.
 * Text inserted exactly at an end leaves the range's own text alone: at the start the range moves
 * behind it, at the end the range stays as it is.
 */
export function mapTrackedRange(from: number, to: number, changes: readonly DocumentChange[]): { from: number; to: number } | null {
    let delta = 0;
    for (const change of changes) {
        if (change.to <= from) {
            delta += change.insertedLength - (change.to - change.from);
            continue;
        }
        if (change.from >= to) {
            break;
        }
        return null;
    }
    return { from: from + delta, to: to + delta };
}
