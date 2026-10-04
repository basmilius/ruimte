import type { Selection, TextEdit } from './types.ts';

interface Mark {
    open: number;
    close: number;
}

const limit = 64;

/*
 * The closers the editor inserted by itself and the caret has not left yet, which Tab steps over. A
 * mark follows its opener and closer through edits and goes as soon as an edit replaces either one
 * or no caret sits inside the pair any more.
 */
export class CloserTracker {
    private marks: Mark[] = [];

    add(open: number, close: number): void {
        this.marks.push({ open, close });
        if (this.marks.length > limit) {
            this.marks.shift();
        }
    }

    /* The closer that sits at `offset`, which a Tab there steps over. */
    isCloserAt(offset: number): boolean {
        return this.marks.some((mark) => mark.close === offset);
    }

    map(edits: readonly TextEdit[]): void {
        this.marks = this.marks.flatMap((mark) => {
            const open = mapThrough(mark.open, edits);
            const close = mapThrough(mark.close, edits);
            return open === null || close === null ? [] : [{ open, close }];
        });
    }

    prune(selections: readonly Selection[]): void {
        this.marks = this.marks.filter((mark) => selections.some((selection) => selection.head > mark.open && selection.head <= mark.close));
    }

    clear(): void {
        this.marks = [];
    }
}

/* Null when an edit replaced the character at `offset`. */
function mapThrough(offset: number, edits: readonly TextEdit[]): number | null {
    let delta = 0;
    for (const edit of edits) {
        if (offset < edit.from) {
            break;
        }
        if (offset < edit.to) {
            return null;
        }
        delta += edit.text.length - (edit.to - edit.from);
    }
    return offset + delta;
}
