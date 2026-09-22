import type { MergeBlock } from './blocks.ts';

export type MergeSide = 'ours' | 'theirs';

export const sideLines = (block: MergeBlock, side: MergeSide): string[] => (side === 'ours' ? [...block.ours] : [...block.theirs]);

/* Both sides, one after the other, for the conflict where the two additions both belong. */
export const bothLines = (block: MergeBlock, first: MergeSide): string[] =>
    first === 'ours' ? [...block.ours, ...block.theirs] : [...block.theirs, ...block.ours];

/* What a block is worth without anyone choosing: the side that changed, or the change both made. */
export const autoLines = (block: MergeBlock): string[] | null => {
    switch (block.kind) {
        case 'stable':
        case 'ours':
        case 'both':
            return [...block.ours];
        case 'theirs':
            return [...block.theirs];
        case 'conflict':
            return null;
    }
};

const squashed = (lines: readonly string[]): string => lines.map((line) => line.trim().replace(/\s+/g, ' ')).join('\n');

/* Whether every line of `inner` appears in `outer`, in the same order and without a gap in `inner`. */
const contains = (outer: readonly string[], inner: readonly string[]): boolean => {
    if (inner.length === 0) {
        return true;
    }
    for (let start = 0; start + inner.length <= outer.length; start += 1) {
        if (inner.every((line, index) => outer[start + index] === line)) {
            return true;
        }
    }
    return false;
};

/*
 * What the wand makes of a conflict, or null for one that needs a person after all. It closes the
 * two nobody would think twice about: the sides that say the same thing in different whitespace, and
 * the side that already holds every line of the other. Anything else is a choice, and a wand that
 * guesses at those is a wand nobody trusts twice.
 */
export const wandLines = (block: MergeBlock): string[] | null => {
    if (block.kind !== 'conflict') {
        return autoLines(block);
    }
    if (squashed(block.ours) === squashed(block.theirs)) {
        return [...block.ours];
    }
    if (block.theirs.length > 0 && contains(block.ours, block.theirs)) {
        return [...block.ours];
    }
    if (block.ours.length > 0 && contains(block.theirs, block.ours)) {
        return [...block.theirs];
    }
    return null;
};

/*
 * A short name for the two sides of one block, so an answer written for it can be checked against
 * the block it lands on. Not a secret and not a digest anyone leans on: it only has to differ when
 * the stretch does, and it has to read the same on a daemon and in a browser, which rules out the
 * one hash a browser cannot take synchronously.
 */
export const fingerprint = (block: MergeBlock): string => {
    let hash = 0x811c9dc5;
    for (const line of [...block.ours, '\u0000', ...block.theirs]) {
        for (let index = 0; index < line.length; index += 1) {
            hash = Math.imul(hash ^ line.charCodeAt(index), 0x01000193);
        }
        hash = Math.imul(hash ^ 0x0a, 0x01000193);
    }
    return (hash >>> 0).toString(16).padStart(8, '0');
};

/* Where one block landed in the draft, `to` exclusive, so a block is a range a person can act on. */
export interface MergeSpan {
    block: number;
    kind: MergeBlock['kind'];
    from: number;
    to: number;
}

export interface MergeDraft {
    lines: string[];
    spans: MergeSpan[];
}

/*
 * The merged file to start from: everything that merges by itself is merged, and every conflict
 * holds our side until someone says otherwise. Never a conflict marker: what a person edits here is
 * a file that would compile, and the other side is a column away rather than a line below. Blocks
 * that have already been answered are passed in, which is how a proposal lands in a file nobody has
 * open.
 */
export const draftOf = (blocks: readonly MergeBlock[], answered: ReadonlyMap<number, readonly string[]> = new Map()): MergeDraft => {
    const lines: string[] = [];
    const spans: MergeSpan[] = [];
    for (const [index, block] of blocks.entries()) {
        const from = lines.length;
        lines.push(...(answered.get(index) ?? autoLines(block) ?? block.ours));
        spans.push({ block: index, kind: block.kind, from, to: lines.length });
    }
    return { lines, spans };
};
