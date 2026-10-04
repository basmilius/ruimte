import type { MergeBlock } from './blocks.ts';

export type MergeSide = 'ours' | 'theirs';

export function sideLines(block: MergeBlock, side: MergeSide): string[] {
    return side === 'ours' ? [...block.ours] : [...block.theirs];
}

/* Both sides, one after the other, for the conflict where the two additions both belong. */
export function bothLines(block: MergeBlock, first: MergeSide): string[] {
    return first === 'ours' ? [...block.ours, ...block.theirs] : [...block.theirs, ...block.ours];
}

/* What a block is worth without anyone choosing: the side that changed, or the change both made. */
export function autoLines(block: MergeBlock): string[] | null {
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
}

function squashed(lines: readonly string[]): string {
    return lines
        .map((line) => {
            const body = line.trim();
            // Indentation is meaning in Python, YAML or a Makefile, so only a blank line loses its own.
            const indent = body === '' ? '' : line.slice(0, line.length - line.trimStart().length);
            return `${indent}${body.replace(/\s+/g, ' ')}`;
        })
        .join('\n');
}

/* Where `inner` starts in `outer` as one run of lines, or -1. */
function runIn(outer: readonly string[], inner: readonly string[]): number {
    for (let start = 0; start + inner.length <= outer.length; start += 1) {
        if (inner.every((line, index) => outer[start + index] === line)) {
            return start;
        }
    }
    return -1;
}

/*
 * Whether `outer` holds every line of `inner` and adds nothing `inner` took out: a base line among
 * what `outer` adds is one `inner` deleted, and taking `outer` would put it back.
 */
function covers(base: readonly string[], outer: readonly string[], inner: readonly string[]): boolean {
    const start = runIn(outer, inner);
    if (inner.length === 0 || start < 0) {
        return false;
    }
    const added = [...outer.slice(0, start), ...outer.slice(start + inner.length)];
    return added.every((line) => !base.includes(line) || inner.includes(line));
}

/*
 * What the wand makes of a conflict, or null for one that needs a person after all. It closes the
 * two nobody would think twice about: the sides that differ only in whitespace inside or after a
 * line, and the side that already holds every line of the other without putting back what the other
 * deleted. Anything else is a choice, and a wand that guesses at those is a wand nobody trusts twice.
 */
export function wandLines(block: MergeBlock): string[] | null {
    if (block.kind !== 'conflict') {
        return autoLines(block);
    }
    if (squashed(block.ours) === squashed(block.theirs)) {
        return [...block.ours];
    }
    if (covers(block.base, block.ours, block.theirs)) {
        return [...block.ours];
    }
    if (covers(block.base, block.theirs, block.ours)) {
        return [...block.theirs];
    }
    return null;
}

/*
 * A short name for the two sides of one block, so an answer written for it can be checked against
 * the block it lands on. Not a secret and not a digest anyone leans on: it only has to differ when
 * the stretch does, and it has to read the same on a daemon and in a browser, which rules out the
 * one hash a browser cannot take synchronously.
 */
export function fingerprint(block: MergeBlock): string {
    let hash = 0x811c9dc5;
    for (const line of [...block.ours, '\u0000', ...block.theirs]) {
        for (let index = 0; index < line.length; index += 1) {
            hash = Math.imul(hash ^ line.charCodeAt(index), 0x01000193);
        }
        hash = Math.imul(hash ^ 0x0a, 0x01000193);
    }
    return (hash >>> 0).toString(16).padStart(8, '0');
}

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
export function draftOf(blocks: readonly MergeBlock[], answered: ReadonlyMap<number, readonly string[]> = new Map()): MergeDraft {
    const lines: string[] = [];
    const spans: MergeSpan[] = [];
    for (const [index, block] of blocks.entries()) {
        const from = lines.length;
        lines.push(...(answered.get(index) ?? autoLines(block) ?? block.ours));
        spans.push({ block: index, kind: block.kind, from, to: lines.length });
    }
    return { lines, spans };
}
