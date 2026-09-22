import { describe, expect, test } from 'bun:test';
import { diffLines } from './diff.ts';
import { openBlocks, splitBlocks } from './blocks.ts';
import { draftOf, wandLines } from './resolve.ts';
import { joinLines, shapeOf, splitLines } from './text.ts';

/* What the changes say the other side holds, which has to be that side line for line. */
const rebuild = (base: readonly string[], other: readonly string[]): string[] => {
    const out: string[] = [];
    let at = 0;
    for (const change of diffLines(base, other)) {
        out.push(...base.slice(at, change.baseStart));
        out.push(...other.slice(change.otherStart, change.otherEnd));
        at = change.baseEnd;
    }
    out.push(...base.slice(at));
    return out;
};

/* A deterministic shuffle of a file: some lines dropped, some changed, some added. */
const mutate = (lines: readonly string[], seed: number): string[] => {
    let state = seed;
    const random = (): number => {
        state = (state + 0x6d2b79f5) | 0;
        let value = Math.imul(state ^ (state >>> 15), 1 | state);
        value = (value + Math.imul(value ^ (value >>> 7), 61 | value)) ^ value;
        return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
    };
    const out: string[] = [];
    for (const line of lines) {
        const roll = random();
        if (roll < 0.15) {
            continue;
        }
        if (roll < 0.3) {
            out.push(`${line}-changed`);
            continue;
        }
        if (roll < 0.4) {
            out.push('inserted');
        }
        out.push(line);
    }
    return out;
};

describe('diffLines', () => {
    test('an unchanged file has no changes', () => {
        expect(diffLines(['a', 'b'], ['a', 'b'])).toEqual([]);
    });

    test('a change in the middle covers only the middle', () => {
        expect(diffLines(['a', 'b', 'c'], ['a', 'x', 'c'])).toEqual([{ baseStart: 1, baseEnd: 2, otherStart: 1, otherEnd: 2 }]);
    });

    test('an insert covers no line of the base', () => {
        expect(diffLines(['a', 'c'], ['a', 'b', 'c'])).toEqual([{ baseStart: 1, baseEnd: 1, otherStart: 1, otherEnd: 2 }]);
    });

    test('the changes rebuild the other side', () => {
        const base = Array.from({ length: 60 }, (_, index) => `line ${index}`);
        for (let seed = 1; seed <= 20; seed += 1) {
            const other = mutate(base, seed);
            expect(rebuild(base, other)).toEqual(other);
        }
    });

    test('two files with nothing in common are one change', () => {
        expect(diffLines(['a', 'b'], ['x', 'y'])).toEqual([{ baseStart: 0, baseEnd: 2, otherStart: 0, otherEnd: 2 }]);
    });
});

describe('splitBlocks', () => {
    test('a change on one side alone is that side', () => {
        const blocks = splitBlocks(['a', 'b', 'c'], ['a', 'ours', 'c'], ['a', 'b', 'c']);
        expect(blocks.map((block) => block.kind)).toEqual(['stable', 'ours', 'stable']);
        expect(openBlocks(blocks)).toBe(0);
    });

    test('the same change on both sides is neither side', () => {
        const blocks = splitBlocks(['a', 'b'], ['a', 'x'], ['a', 'x']);
        expect(blocks.map((block) => block.kind)).toEqual(['stable', 'both']);
    });

    test('changes that overlap in the base are one conflict', () => {
        const blocks = splitBlocks(['a', 'b', 'c'], ['a', 'ours', 'c'], ['a', 'theirs', 'c']);
        expect(blocks.map((block) => block.kind)).toEqual(['stable', 'conflict', 'stable']);
        const conflict = blocks.find((block) => block.kind === 'conflict')!;
        expect(conflict.ours).toEqual(['ours']);
        expect(conflict.theirs).toEqual(['theirs']);
        expect(conflict.base).toEqual(['b']);
    });

    test('changes far apart stay apart', () => {
        const base = ['a', 'b', 'c', 'd', 'e'];
        const blocks = splitBlocks(base, ['ours', 'b', 'c', 'd', 'e'], ['a', 'b', 'c', 'd', 'theirs']);
        expect(blocks.map((block) => block.kind)).toEqual(['ours', 'stable', 'theirs']);
    });

    test('both sides adding in the same place is a conflict', () => {
        const blocks = splitBlocks(['a', 'b'], ['a', 'ours', 'b'], ['a', 'theirs', 'b']);
        expect(blocks.map((block) => block.kind)).toEqual(['stable', 'conflict', 'stable']);
    });

    test('a file that only one side added to is that side whole', () => {
        expect(splitBlocks([], [], ['a'])).toEqual([{ kind: 'theirs', base: [], ours: [], theirs: ['a'] }]);
    });
});

describe('draftOf', () => {
    test('what merges by itself is merged', () => {
        const base = ['a', 'b', 'c', 'd', 'e'];
        const blocks = splitBlocks(base, ['ours', 'b', 'c', 'd', 'e'], ['a', 'b', 'c', 'd', 'theirs']);
        expect(draftOf(blocks).lines).toEqual(['ours', 'b', 'c', 'd', 'theirs']);
    });

    test('a conflict holds our side and is marked where it sits', () => {
        const blocks = splitBlocks(['a', 'b', 'c'], ['a', 'ours', 'c'], ['a', 'theirs', 'c']);
        const draft = draftOf(blocks);
        expect(draft.lines).toEqual(['a', 'ours', 'c']);
        expect(draft.spans.filter((span) => span.kind === 'conflict')).toEqual([{ block: 1, kind: 'conflict', from: 1, to: 2 }]);
    });
});

describe('wandLines', () => {
    test('sides that differ only in whitespace take ours', () => {
        const blocks = splitBlocks(['a'], ['const x = 1;'], ['const  x   = 1;']);
        expect(wandLines(blocks[0]!)).toEqual(['const x = 1;']);
    });

    test('the side that already holds the other wins', () => {
        const blocks = splitBlocks(['a'], ['one', 'two'], ['one']);
        expect(wandLines(blocks[0]!)).toEqual(['one', 'two']);
    });

    test('a real choice is left alone', () => {
        const blocks = splitBlocks(['a'], ['ours'], ['theirs']);
        expect(wandLines(blocks[0]!)).toBeNull();
    });
});

describe('text', () => {
    test('a file keeps its line ending and its last newline', () => {
        const text = 'a\r\nb\r\n';
        const shape = shapeOf(text);
        expect(shape).toEqual({ eol: '\r\n', finalNewline: true });
        expect(joinLines(splitLines(text), shape)).toBe(text);
    });

    test('a file without a closing newline keeps ending without one', () => {
        const text = 'a\nb';
        expect(joinLines(splitLines(text), shapeOf(text))).toBe(text);
    });

    test('an empty file stays empty', () => {
        expect(joinLines(splitLines(''), shapeOf(''))).toBe('');
    });
});
