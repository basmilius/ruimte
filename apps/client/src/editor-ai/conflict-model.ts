import { splitBlocks, splitLines, type MergeBlock } from '@ruimte/merge';
import type { LineReplacement } from './line-edits';

/* A stretch both sides changed, as the lines each has of it. */
export interface ConflictStretch {
    base: readonly string[];
    ours: readonly string[];
    theirs: readonly string[];
    /* Zero-based, `to` exclusive, in the text once everything that merges has merged. */
    from: number;
    to: number;
    /* One-based and inclusive in the incoming text; `end` is below `start` when the other side removed the stretch. */
    theirsStart: number;
    theirsEnd: number;
}

export interface ConflictPlan {
    /* What the other side changed alone, as replacements of the lines of our text. */
    merges: LineReplacement[];
    conflicts: ConflictStretch[];
}

/*
 * Where two versions of a file that grew from one disagree. The stretches only the incoming text changed
 * are ours to take without asking; only a stretch both sides changed needs a person.
 */
export function planConflict(base: string, ours: string, theirs: string): ConflictPlan {
    const blocks: MergeBlock[] = splitBlocks(splitLines(base), splitLines(ours), splitLines(theirs));
    const merges: LineReplacement[] = [];
    const conflicts: ConflictStretch[] = [];
    let oursAt = 0;
    let theirsAt = 0;
    let mergedAt = 0;
    for (const block of blocks) {
        if (block.kind === 'theirs') {
            merges.push({ from: oursAt, to: oursAt + block.ours.length, lines: block.theirs });
            mergedAt += block.theirs.length;
        } else {
            if (block.kind === 'conflict') {
                conflicts.push({
                    base: block.base,
                    ours: block.ours,
                    theirs: block.theirs,
                    from: mergedAt,
                    to: mergedAt + block.ours.length,
                    theirsStart: theirsAt + 1,
                    theirsEnd: theirsAt + block.theirs.length
                });
            }
            mergedAt += block.ours.length;
        }
        oursAt += block.ours.length;
        theirsAt += block.theirs.length;
    }
    return { merges, conflicts };
}
