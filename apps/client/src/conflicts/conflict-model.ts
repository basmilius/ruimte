import type { GitConflictKind, GitConflictResult, GitResolveBlock } from '@ruimte/contracts';
import { draftOf, fingerprint, joinLines, shapeOf, splitBlocks, splitLines, type MergeBlock, type MergeSpan, type TextShape } from '@ruimte/merge';
import type { ConflictDraft } from '@/conflicts/editor';

/* One unmerged file as the overlay works on it: the three versions split into stretches, the merged
   file to start from, and the shape the result is written back in. */
export interface ConflictFile {
    path: string;
    kind: GitConflictKind;
    blocks: MergeBlock[];
    /* Where every block sits in `text`, by line, `to` exclusive. */
    spans: MergeSpan[];
    text: string;
    shape: TextShape;
    /* What stood on disk when this was read; the resolution is written over exactly that. */
    hash: string;
    /* Set when there is nothing to merge line by line: the file is a choice between whole sides. */
    whole: boolean;
}

/* The three versions git handed back, as the file the overlay draws. */
export const fileOf = (answer: GitConflictResult): ConflictFile => {
    const whole = answer.kind !== 'text' || answer.ours === null || answer.theirs === null;
    const blocks = whole ? [] : splitBlocks(splitLines(answer.base ?? ''), splitLines(answer.ours ?? ''), splitLines(answer.theirs ?? ''));
    const draft = draftOf(blocks);
    return {
        path: answer.path,
        kind: answer.kind,
        blocks,
        spans: draft.spans,
        text: draft.lines.join('\n'),
        // Our side decides the shape: the result goes on the branch the checkout is on.
        shape: shapeOf(answer.ours ?? answer.theirs ?? answer.base ?? ''),
        hash: answer.hash,
        whole
    };
};

/* The merged file as it goes to disk: the editor works in plain newlines, the file keeps its own. */
export const contentOf = (file: ConflictFile, text: string): string => joinLines(text === '' ? [] : text.split('\n'), file.shape);

/* Every conflict of the file, settled or not, which is what the arrows walk through. */
export const conflictIndexes = (file: ConflictFile): number[] => file.blocks.flatMap((block, index) => (block.kind === 'conflict' ? [index] : []));

/* The conflict after this one, wrapping around at the end so the arrows never run out. */
export const nextConflict = (indexes: readonly number[], current: number | null, step: 1 | -1): number | null => {
    if (indexes.length === 0) {
        return null;
    }
    if (current === null) {
        return (step === 1 ? indexes[0] : indexes[indexes.length - 1]) ?? null;
    }
    const at = indexes.indexOf(current);
    if (at < 0) {
        return (step === 1 ? indexes.find((index) => index > current) : [...indexes].reverse().find((index) => index < current)) ?? indexes[0] ?? null;
    }
    return indexes[(at + step + indexes.length) % indexes.length] ?? null;
};

/* Where every line starts, with the end of the text behind the last one. */
const lineOffsets = (lines: readonly string[]): number[] => {
    const offsets = [0];
    for (const line of lines) {
        offsets.push(offsets[offsets.length - 1]! + line.length + 1);
    }
    // The last line carries no break, so the text ends one character earlier than the walk counted.
    offsets[offsets.length - 1] = Math.max(0, offsets[offsets.length - 1]! - 1);
    return offsets;
};

/*
 * A file with some of its conflicts answered, without an editor. This is what an answer lands in
 * for every file but the one on screen: the same draft the editor would have built, with the
 * answered stretches in place and settled.
 */
export const draftWith = (file: ConflictFile, answered: ReadonlyMap<number, readonly string[]>): ConflictDraft => {
    const draft = draftOf(file.blocks, answered);
    const offsets = lineOffsets(draft.lines);
    return {
        text: draft.lines.join('\n'),
        spans: draft.spans.map((span) => ({
            block: span.block,
            kind: span.kind,
            from: offsets[span.from] ?? 0,
            to: offsets[span.to] ?? 0,
            settled: span.kind !== 'conflict' || answered.has(span.block)
        }))
    };
};

/* The conflicts of a draft that still need a person. */
export const openInDraft = (draft: ConflictDraft): number[] =>
    draft.spans.filter((span) => span.kind === 'conflict' && !span.settled).map((span) => span.block);

/*
 * The proposals that still fit the file in front of us. A fingerprint that does not match is an
 * answer written for another version of the stretch, which is a proposal to drop rather than to
 * apply somewhere it was never meant.
 */
export const usableBlocks = (file: ConflictFile, answers: readonly GitResolveBlock[]): { index: number; lines: string[] }[] =>
    answers
        .filter((answer) => {
            const block = file.blocks[answer.index];
            return block !== undefined && block.kind === 'conflict' && fingerprint(block) === answer.fingerprint;
        })
        .map((answer) => ({ index: answer.index, lines: answer.lines }));
