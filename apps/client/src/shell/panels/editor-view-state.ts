import type { EditorFolds, FoldRole } from '@ruimte/smart-editor';
import type { RevealLineRequest } from '@/state/files';

export interface ViewState {
    readonly scrollTop: number;
    /* One-based, as the editor opens on it. */
    readonly line: number;
    readonly column: number;
    /* What was folded, which the editor folds again. */
    readonly folds: EditorFolds;
}

/* Where each file's editor was when it went, so switching tabs or a node scrolling back into view opens it there again. Per window, never stored. */
export const viewStates = new Map<string, ViewState>();

/*
 * A line asked for wins; otherwise where this file's editor last was, and for a file opened the first time, where the
 * viewer before it was scrolled and with the kinds of fold the settings choose folded. What was folded comes back
 * whichever way it opens.
 */
export function openingPlace(
    reveal: RevealLineRequest | null,
    last: ViewState | undefined,
    placeholderScroll: number,
    foldDefaults: readonly FoldRole[]
): { line?: number; column?: number; scrollTop?: number; folds?: EditorFolds; foldDefaults?: readonly FoldRole[] } {
    const folds = last === undefined ? { foldDefaults } : { folds: last.folds };
    if (reveal !== null) {
        return { line: reveal.line, ...folds };
    }
    if (last !== undefined) {
        return { line: last.line, column: last.column, scrollTop: last.scrollTop, ...folds };
    }
    return { scrollTop: placeholderScroll, ...folds };
}
