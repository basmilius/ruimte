import { diffLines, type Change } from './diff.ts';

/*
 * What happened to one stretch of a file between the version the two sides started from and what
 * each of them made of it. Only `conflict` needs a person: the rest is one side's change, or the
 * same change made twice.
 */
export type MergeBlockKind = 'stable' | 'ours' | 'theirs' | 'both' | 'conflict';

export interface MergeBlock {
    kind: MergeBlockKind;
    base: string[];
    ours: string[];
    theirs: string[];
}

const same = (left: readonly string[], right: readonly string[]): boolean => left.length === right.length && left.every((line, index) => line === right[index]);

const kindOf = (base: readonly string[], ours: readonly string[], theirs: readonly string[]): MergeBlockKind => {
    if (same(ours, theirs)) {
        return same(base, ours) ? 'stable' : 'both';
    }
    if (same(base, ours)) {
        return 'theirs';
    }
    if (same(base, theirs)) {
        return 'ours';
    }
    return 'conflict';
};

/* How many lines a change adds over what it replaces, which is how far it moves everything after it. */
const delta = (change: Change): number => change.otherEnd - change.otherStart - (change.baseEnd - change.baseStart);

/*
 * The three versions of a file as the stretches they agree and disagree on, in reading order. A
 * stretch is taken up by both sides at once only where their changes overlap in the base, or where
 * both added something in exactly the same place; anything else is one side's alone and merges
 * without asking. This is what every other function here counts, draws and resolves.
 */
export const splitBlocks = (base: readonly string[], ours: readonly string[], theirs: readonly string[]): MergeBlock[] => {
    const ourChanges = diffLines(base, ours);
    const theirChanges = diffLines(base, theirs);
    const blocks: MergeBlock[] = [];
    let baseAt = 0;
    let ourAt = 0;
    let theirAt = 0;
    let ourNext = 0;
    let theirNext = 0;

    const push = (baseEnd: number, ourEnd: number, theirEnd: number): void => {
        const stretch = { base: base.slice(baseAt, baseEnd), ours: ours.slice(ourAt, ourEnd), theirs: theirs.slice(theirAt, theirEnd) };
        if (stretch.base.length > 0 || stretch.ours.length > 0 || stretch.theirs.length > 0) {
            blocks.push({ kind: kindOf(stretch.base, stretch.ours, stretch.theirs), ...stretch });
        }
        baseAt = baseEnd;
        ourAt = ourEnd;
        theirAt = theirEnd;
    };

    while (ourNext < ourChanges.length || theirNext < theirChanges.length) {
        const start = Math.min(ourChanges[ourNext]?.baseStart ?? Infinity, theirChanges[theirNext]?.baseStart ?? Infinity);
        if (start > baseAt) {
            const length = start - baseAt;
            push(start, ourAt + length, theirAt + length);
        }
        let end = baseAt;
        let ourGrowth = 0;
        let theirGrowth = 0;
        /* The stretch grows while a change of either side reaches into it: two changes that overlap
           in the base are one thing a person has to look at, however far apart they started. */
        for (let taken = true; taken;) {
            taken = false;
            const reaches = (change: Change | undefined): boolean =>
                change !== undefined && change.baseStart <= end && (change.baseStart < end || end === baseAt);
            while (reaches(ourChanges[ourNext])) {
                const change = ourChanges[ourNext]!;
                end = Math.max(end, change.baseEnd);
                ourGrowth += delta(change);
                ourNext += 1;
                taken = true;
            }
            while (reaches(theirChanges[theirNext])) {
                const change = theirChanges[theirNext]!;
                end = Math.max(end, change.baseEnd);
                theirGrowth += delta(change);
                theirNext += 1;
                taken = true;
            }
        }
        push(end, ourAt + (end - baseAt) + ourGrowth, theirAt + (end - baseAt) + theirGrowth);
    }
    push(base.length, ours.length, theirs.length);
    return blocks;
};

/* The stretches a person still has to decide on. */
export const openBlocks = (blocks: readonly MergeBlock[]): number => blocks.filter((block) => block.kind === 'conflict').length;
