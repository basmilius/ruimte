import { resolve } from 'node:path';
import { writeGenerated } from '../../../apps/ios/Scripts/generated.ts';
import { adecore, compactFixture, seeded } from './adecore-port.ts';

/*
 * The cases the phone's three-way merge is held to, with the answer `@adecore/merge` gives. The daemon answers
 * `git.resolveAi` by block index and fingerprint, so the phone has to split a conflict file into the same blocks.
 */
interface MergeBlock {
    kind: string;
    base: string[];
    ours: string[];
    theirs: string[];
}

const { diffLines, draftOf, fingerprint, joinLines, shapeOf, splitBlocks, splitLines, wandLines } = await adecore<{
    diffLines(base: string[], other: string[]): { baseStart: number; baseEnd: number; otherStart: number; otherEnd: number }[];
    draftOf(blocks: MergeBlock[]): { lines: string[] };
    fingerprint(block: MergeBlock): string;
    joinLines(lines: string[], shape: { eol: string; finalNewline: boolean }): string;
    shapeOf(text: string): { eol: string; finalNewline: boolean };
    splitBlocks(base: string[], ours: string[], theirs: string[]): MergeBlock[];
    splitLines(text: string): string[];
    wandLines(block: MergeBlock): string[] | null;
}>('@adecore/merge');

const destination = resolve(import.meta.dir, '../../../apps/ios/Tests/Fixtures/ports-merge.json');

type Triple = { base: string[]; ours: string[]; theirs: string[] };

const handWritten: Triple[] = [
    { base: ['a', 'b', 'c'], ours: ['a', 'ours', 'c'], theirs: ['a', 'theirs', 'c'] },
    { base: ['a'], ours: ['é', '日本'], theirs: ['\u{1f600}'] },
    { base: [], ours: [], theirs: [] },
    { base: ['x', 'y', 'z', 'w', 'v'], ours: ['x', 'y2', 'z', 'w', 'v', 'u'], theirs: ['q', 'x', 'y3', 'z', 'w'] },
    { base: ['a', 'b', 'c', 'a', 'b', 'b', 'a'], ours: ['c', 'b', 'a', 'b', 'a', 'c'], theirs: ['a', 'b', 'c', 'a', 'b', 'b', 'a'] },
    { base: ['a', 'b', 'c', 'd', 'e'], ours: ['ours', 'b', 'c', 'd', 'e'], theirs: ['a', 'b', 'c', 'd', 'theirs'] },
    { base: ['a', 'b'], ours: ['a', 'ours', 'b'], theirs: ['a', 'theirs', 'b'] },
    { base: ['a', 'b'], ours: ['a', 'x', 'b'], theirs: ['a', 'x', 'b'] },
    { base: ['a', 'b'], ours: ['a'], theirs: ['a'] },
    { base: ['a', 'b'], ours: [], theirs: ['a', 'b'] },
    { base: [], ours: ['new'], theirs: [] },
    { base: [], ours: ['new'], theirs: ['new'] },
    { base: [], ours: ['one'], theirs: ['two'] },
    { base: ['a', 'b', 'c'], ours: ['a', 'c'], theirs: ['a', 'b2', 'c'] },
    { base: ['a', 'b', 'c', 'd'], ours: ['a', 'c', 'd'], theirs: ['a', 'b', 'd'] },
    { base: ['a', 'b', 'c', 'd'], ours: ['a', 'x', 'd'], theirs: ['a', 'y', 'd'] },
    { base: ['a', '', 'b', '', 'c'], ours: ['a', '', '', 'c'], theirs: ['a', '', 'b', '', 'c', '', ''] },
    { base: ['x = 1'], ours: ['x = 2', ''], theirs: ['x = 2', '    '] },
    { base: ['    x = 1'], ours: ['    x = 2'], theirs: ['x = 2'] },
    { base: ['\tx = 1'], ours: ['\tx = 2'], theirs: ['    x = 2'] },
    { base: ['old1', 'old2'], ours: ['import NEW', 'old1', 'old2'], theirs: ['import NEW'] },
    { base: ['old'], ours: ['new', 'more'], theirs: ['new'] },
    { base: ['a'], ours: ['one', 'two'], theirs: ['one'] },
    { base: ['a'], ours: ['const x = 1;'], theirs: ['const  x   = 1;'] },
    // The same accented letter spelled composed and decomposed is two different lines.
    { base: ['café'], ours: ['café'], theirs: ['café'] },
    { base: ['café', 'x'], ours: ['café', 'x'], theirs: ['café', 'y'] },
    // Fingerprints read UTF-16 units, so a pair of them and a lone astral character are not the same as one scalar.
    { base: ['a'], ours: ['\u{1f468}‍\u{1f469}‍\u{1f467}'], theirs: ['\u{1f1f3}\u{1f1f1}'] },
    { base: ['a'], ours: ['\u0000'], theirs: ['\u0000\u0000'] },
    { base: ['a'], ours: [' '], theirs: ['\u0085', '\u000b', '\u000c'] },
    // A line that looks like a marker is content.
    { base: ['a', '=======', 'b'], ours: ['a', '<<<<<<< HEAD', 'x', '=======', 'y', '>>>>>>> other', 'b'], theirs: ['a', '||||||| base', 'b'] },
    { base: ['a'], ours: ['<<<<<<< ours', 'one', '||||||| base', 'a', '=======', 'two', '>>>>>>> theirs'], theirs: ['three'] },
    // A tie of the diff: several shortest scripts exist.
    { base: ['a', 'a', 'a'], ours: ['a'], theirs: ['a', 'a'] },
    { base: ['a', 'b', 'a', 'b'], ours: ['b', 'a', 'b', 'a'], theirs: ['a', 'b', 'a', 'b', 'a'] },
    { base: ['x', 'a', 'a', 'y'], ours: ['x', 'a', 'y'], theirs: ['x', 'a', 'a', 'a', 'y'] },
    { base: ['a', 'b', 'c', 'a', 'b', 'c'], ours: ['b', 'c', 'a', 'b', 'c', 'a'], theirs: ['c', 'a', 'b', 'c', 'a', 'b'] }
];

const words = ['alpha', 'beta', 'gamma', 'delta', '', '}', 'return x;', 'café', '日本', '\u{1f600}'];

function mutate(random: () => number, lines: string[], rate: number, pool: string[]): string[] {
    const result: string[] = [];

    for (const line of lines) {
        const roll = random();

        if (roll < rate / 3) {
            continue;
        }

        if (roll < (rate * 2) / 3) {
            result.push(pool[Math.floor(random() * pool.length)]!);
            continue;
        }

        if (roll < rate) {
            result.push(line, pool[Math.floor(random() * pool.length)]!);
            continue;
        }

        result.push(line);
    }

    return result;
}

function generated(): Triple[] {
    const random = seeded(2026);
    const triples: Triple[] = [];

    for (let index = 0; index < 200; index += 1) {
        const size = Math.floor(random() * 40);
        const pool = index % 3 === 0 ? words.slice(0, 4) : words;
        const base = Array.from({ length: size }, () => pool[Math.floor(random() * pool.length)]!);
        const rate = 0.05 + random() * 0.4;

        triples.push({ base, ours: mutate(random, base, rate, pool), theirs: mutate(random, base, rate, pool) });
    }

    // Long files, where the walk passes its stride and replays rounds on the way back.
    for (const [length, rate] of [
        [260, 0.15],
        [260, 0.45],
        [200, 0.6]
    ] as const) {
        const pool = words.slice(0, 6);
        const base = Array.from({ length }, (_, line) => `${pool[line % pool.length]} ${line % 13}`);

        triples.push({ base, ours: mutate(random, base, rate, pool), theirs: mutate(random, base, rate, pool) });
    }

    return triples;
}

function answer({ base, ours, theirs }: Triple): unknown {
    const blocks = splitBlocks(base, ours, theirs);

    return {
        base,
        ours,
        theirs,
        ourChanges: diffLines(base, ours),
        theirChanges: diffLines(base, theirs),
        blocks: blocks.map((block) => ({ ...block, fingerprint: fingerprint(block), wand: wandLines(block) })),
        draft: draftOf(blocks).lines
    };
}

const files: { base: string; ours: string; theirs: string }[] = [
    { base: 'a\nb\nc\n', ours: 'a\nours\nc\n', theirs: 'a\ntheirs\nc\n' },
    { base: 'a\r\nb\r\nc\r\n', ours: 'a\r\nours\r\nc\r\n', theirs: 'a\r\ntheirs\r\nc\r\n' },
    { base: 'a\r\nb\r\nc', ours: 'a\r\nours\r\nc', theirs: 'a\r\ntheirs\r\nc' },
    { base: 'a\nb\r\nc\n', ours: 'a\nb\r\nc\n', theirs: 'a\nB\r\nc\n' },
    { base: 'a\rb\nc\n', ours: 'a\rb\nours\n', theirs: 'a\rb\ntheirs\n' },
    { base: 'a\r\r\nb\n', ours: 'a\r\r\nb2\n', theirs: 'a\r\r\nb3\n' },
    { base: '', ours: 'one\n', theirs: 'two\n' },
    { base: '', ours: '', theirs: '' },
    { base: '\n', ours: '\n\n', theirs: '\n' },
    { base: '\n\n', ours: '\n', theirs: '\n\n\n' },
    { base: 'a', ours: 'a\n', theirs: 'a' },
    { base: 'a\nb', ours: 'a\nb\n', theirs: 'a\nB' },
    { base: 'café\n', ours: 'café\n', theirs: 'café!\n' },
    { base: 'x\n\u{1f600}\n日本\n', ours: 'x\n\u{1f601}\n日本\n', theirs: 'x\n\u{1f602}\n日本語\n' },
    { base: 'a\n<<<<<<< HEAD\nb\n=======\nc\n>>>>>>> x\n', ours: 'a\n<<<<<<< HEAD\nb\n=======\nd\n>>>>>>> x\n', theirs: 'a\n' },
    { base: 'one\n||||||| base\ntwo\n', ours: 'one\n||||||| base\nthree\n', theirs: 'ONE\n||||||| base\ntwo\n' },
    { base: 'a b\nc\n', ours: 'a b\nd\n', theirs: 'a B\nc\n' },
    { base: '﻿a\nb\n', ours: '﻿a\nB\n', theirs: 'a\nb\n' },
    { base: 'a\n\n\nb\n', ours: 'a\n\nb\n', theirs: 'a\n\n\n\nb\n' },
    { base: 'tab\there\n  indented\n', ours: 'tab\there\n    indented\n', theirs: 'tab\there\n  indented \n' }
];

function fileAnswer({ base, ours, theirs }: { base: string; ours: string; theirs: string }): unknown {
    const blocks = splitBlocks(splitLines(base), splitLines(ours), splitLines(theirs));
    const shape = shapeOf(ours);

    return {
        base,
        ours,
        theirs,
        baseLines: splitLines(base),
        oursLines: splitLines(ours),
        theirsLines: splitLines(theirs),
        shapes: { base: shapeOf(base), ours: shape, theirs: shapeOf(theirs) },
        blockKinds: blocks.map((block) => block.kind),
        blockPrints: blocks.map((block) => fingerprint(block)),
        merged: joinLines(draftOf(blocks).lines, shape)
    };
}

const joinCases = [
    { lines: [], eol: '\n', finalNewline: true },
    { lines: [], eol: '\r\n', finalNewline: false },
    { lines: ['a'], eol: '\n', finalNewline: true },
    { lines: ['a'], eol: '\n', finalNewline: false },
    { lines: ['a', 'b'], eol: '\r\n', finalNewline: true },
    { lines: ['a', ''], eol: '\r\n', finalNewline: false }
].map((entry) => ({ ...entry, text: joinLines(entry.lines, { eol: entry.eol, finalNewline: entry.finalNewline }) }));

const cases = {
    triples: [...handWritten, ...generated()].map(answer),
    files: files.map(fileAnswer),
    join: joinCases
};

await writeGenerated(new Map([[destination, compactFixture(cases)]]), `${cases.triples.length} three-way merge cases`);
