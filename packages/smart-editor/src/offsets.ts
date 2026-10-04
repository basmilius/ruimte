import type { DocumentChange } from '@ruimte/smart-editor-core';

/* Where an offset is after a batch of changes. One inside a replaced range lands after the new text. */
export function mapOffset(offset: number, changes: readonly DocumentChange[]): number {
    let delta = 0;
    for (const change of changes) {
        if (offset < change.from) {
            break;
        }
        if (offset < change.to || (offset === change.from && change.from === change.to)) {
            return change.from + delta + change.insertedLength;
        }
        delta += change.insertedLength - (change.to - change.from);
    }
    return offset + delta;
}
