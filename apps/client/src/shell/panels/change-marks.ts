import { diffLines, splitLines } from '@adecore/merge';
import type { EditorChangeMark } from '@adecore/editor';

/*
 * Where a text differs from the version it is compared against, as the marks the editor draws. A
 * stretch that replaces lines is changed as far as it has lines on both sides, and the lines past that
 * are added; one that only removes lines is marked where they were.
 */
export function changeMarksOf(base: string, text: string): EditorChangeMark[] {
    const marks: EditorChangeMark[] = [];
    for (const change of diffLines(splitLines(base), splitLines(text))) {
        const removed = change.baseEnd - change.baseStart;
        const written = change.otherEnd - change.otherStart;
        if (written === 0) {
            marks.push({ kind: 'deleted', startLine: change.otherStart + 1, endLine: change.otherStart + 1 });
            continue;
        }
        const changed = Math.min(removed, written);
        if (changed > 0) {
            marks.push({ kind: 'modified', startLine: change.otherStart + 1, endLine: change.otherStart + changed });
        }
        if (written > changed) {
            marks.push({ kind: 'added', startLine: change.otherStart + changed + 1, endLine: change.otherEnd });
        }
    }
    return marks;
}
