import type { TextEdit } from './types.ts';

/* An offset after simultaneous edits. An edit that inserts at it leaves it in front of the new text when `stayBefore`. */
export function mapOffset(offset: number, edits: readonly TextEdit[], stayBefore = false): number {
    let delta = 0;
    for (const edit of edits) {
        if (offset < edit.from || (stayBefore && offset === edit.from && edit.to === edit.from)) {
            break;
        }
        if (offset < edit.to) {
            return edit.from + delta + edit.text.length;
        }
        delta += edit.text.length - (edit.to - edit.from);
    }
    return offset + delta;
}
