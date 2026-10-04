import type { RevealLineRequest } from '@/state/files';

export interface ViewState {
    readonly scrollTop: number;
    /* One-based, as the editor opens on it. */
    readonly line: number;
    readonly column: number;
}

/* Where each file's editor was when it went, so switching tabs or a node scrolling back into view opens it there again. Per window, never stored. */
export const viewStates = new Map<string, ViewState>();

/* A line asked for wins; otherwise where this file's editor last was, and for a file opened the first time, where the viewer before it was scrolled. */
export function openingPlace(
    reveal: RevealLineRequest | null,
    last: ViewState | undefined,
    placeholderScroll: number
): { line?: number; column?: number; scrollTop?: number } {
    if (reveal !== null) {
        return { line: reveal.line };
    }
    if (last !== undefined) {
        return { line: last.line, column: last.column, scrollTop: last.scrollTop };
    }
    return { scrollTop: placeholderScroll };
}
