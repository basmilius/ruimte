import type { EditorFolds } from '@adecore/editor';

/* The unchanged lines kept on each side of a change. */
export const REVIEW_CONTEXT = 3;

/* The fewest lines worth a fold: hiding one or two would save no room and cost a chip. */
const MIN_HIDDEN = 3;

/* The lines of a change, one-based and inclusive; a removal with nothing added has `endLine` below `startLine`. */
interface ChangedLines {
    readonly startLine: number;
    readonly endLine: number;
}

/*
 * The folds that hide the stretches of unchanged lines in a file under review, keeping `REVIEW_CONTEXT`
 * lines around every change. A fold leaves its first line showing with a chip, so that line is the last
 * of the context above the stretch, or the first line of the file for a stretch at its top. A removal with
 * nothing added stands in front of the line it names, which is kept as a changed line.
 */
export function unchangedFolds(changes: readonly ChangedLines[], lineCount: number): EditorFolds {
    if (lineCount === 0 || changes.length === 0) {
        return { collapsed: [], custom: [] };
    }

    const changed = new Array<boolean>(lineCount).fill(false);

    for (const change of changes) {
        const first = Math.min(change.startLine, lineCount) - 1;
        const last = Math.max(first, Math.min(change.endLine, lineCount) - 1);

        for (let line = Math.max(0, first); line <= last; line++) {
            changed[line] = true;
        }
    }

    const folds: Array<{ startLine: number; endLine: number }> = [];
    let line = 0;

    while (line < lineCount) {
        if (changed[line]) {
            line++;
            continue;
        }

        const first = line;

        while (line < lineCount && !changed[line]) {
            line++;
        }

        const last = line - 1;
        const startLine = first === 0 ? 0 : first + REVIEW_CONTEXT - 1;
        const endLine = line === lineCount ? last : last - REVIEW_CONTEXT;

        if (endLine - startLine >= MIN_HIDDEN) {
            folds.push({ startLine, endLine });
        }
    }

    return { collapsed: folds, custom: folds };
}
