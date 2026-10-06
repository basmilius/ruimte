import type { EditorFolds, FoldRole } from '@adecore/editor';
import type { RevealLineRequest } from '@/state/files';
import { endpointKey } from '@/state/keys';

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

/* Where a place the editors know by the key it had goes now: a file, or the files of a folder that moved. */
const moves: Array<{ from: string; to: string }> = [];

function movedKey(key: string, from: string, to: string): string | null {
    if (key === from) {
        return to;
    }
    return key.startsWith(`${from}/`) ? `${to}${key.slice(from.length)}` : null;
}

/*
 * A file or folder moved, so where its editors were follows it. An editor that is still open writes its place once
 * more under the key it mounted with as it closes, which `viewStateKey` sends to the new one; a new editor on the
 * old path forgets the move.
 */
export function followViewStates(endpointId: string, from: string, to: string): void {
    const oldKey = endpointKey(endpointId, from);
    const newKey = endpointKey(endpointId, to);
    for (const [key, state] of [...viewStates]) {
        const target = movedKey(key, oldKey, newKey);
        if (target !== null) {
            viewStates.delete(key);
            viewStates.set(target, state);
        }
    }
    moves.push({ from: oldKey, to: newKey });
}

/* The key an editor that mounted under `key` leaves its place under. */
export function viewStateKey(key: string): string {
    for (const { from, to } of moves) {
        const target = movedKey(key, from, to);
        if (target !== null) {
            return target;
        }
    }
    return key;
}

/* An editor mounts under `key`, which is a file of its own again whatever moved away from there. */
export function forgetMovesFrom(key: string): void {
    for (let i = moves.length - 1; i >= 0; i--) {
        if (movedKey(key, moves[i]!.from, moves[i]!.to) !== null) {
            moves.splice(i, 1);
        }
    }
}
