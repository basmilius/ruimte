import { describe, expect, test } from 'bun:test';
import { carriesPaths, dropEffectFor, dropPoints, droppedPaths, PATHS_DRAG_TYPE, type DragPayload } from '@/canvas/drop';
import { MENTION_DRAG_TYPE } from '@/chat/mentions';

const drag = (values: Record<string, string>): DragPayload => ({
    types: Object.keys(values),
    getData: (type) => values[type] ?? ''
});

describe('carriesPaths', () => {
    test('takes either type a drag inside the app writes', () => {
        expect(carriesPaths([PATHS_DRAG_TYPE])).toBe(true);
        expect(carriesPaths([MENTION_DRAG_TYPE])).toBe(true);
        expect(carriesPaths(['text/plain', PATHS_DRAG_TYPE, MENTION_DRAG_TYPE])).toBe(true);
    });

    test('leaves every other drag alone, a file out of Finder among them', () => {
        expect(carriesPaths([])).toBe(false);
        expect(carriesPaths(['Files'])).toBe(false);
        expect(carriesPaths(['text/plain'])).toBe(false);
    });
});

describe('droppedPaths', () => {
    test('reads one path', () => {
        expect(droppedPaths(drag({ [PATHS_DRAG_TYPE]: 'src/main.ts' }))).toEqual(['src/main.ts']);
    });

    test('reads a selection of several, in the order the source wrote them', () => {
        expect(droppedPaths(drag({ [PATHS_DRAG_TYPE]: 'src/main.ts docs/README.md a.txt' }))).toEqual(['src/main.ts', 'docs/README.md', 'a.txt']);
    });

    test('leaves a directory out, on either kind of machine', () => {
        expect(droppedPaths(drag({ [PATHS_DRAG_TYPE]: 'src/ src/main.ts docs\\' }))).toEqual(['src/main.ts']);
    });

    test('takes an absolute path as it is', () => {
        expect(droppedPaths(drag({ [PATHS_DRAG_TYPE]: '/etc/hosts' }))).toEqual(['/etc/hosts']);
    });

    test('falls back to the mention type, which has no slashes left to judge', () => {
        expect(droppedPaths(drag({ [MENTION_DRAG_TYPE]: 'src/main.ts a.txt' }))).toEqual(['src/main.ts', 'a.txt']);
    });

    test('answers nothing for a drag that carries something else', () => {
        expect(droppedPaths(drag({ 'text/plain': 'src/main.ts' }))).toEqual([]);
        expect(droppedPaths(drag({ Files: '' }))).toEqual([]);
    });

    test('drops the empty pieces of a payload with stray spaces', () => {
        expect(droppedPaths(drag({ [PATHS_DRAG_TYPE]: '  src/main.ts   a.txt ' }))).toEqual(['src/main.ts', 'a.txt']);
        expect(droppedPaths(drag({ [PATHS_DRAG_TYPE]: '' }))).toEqual([]);
    });
});

describe('dropEffectFor', () => {
    test('copies whenever the source allows it', () => {
        expect(dropEffectFor('copy')).toBe('copy');
        expect(dropEffectFor('copyMove')).toBe('copy');
        expect(dropEffectFor('all')).toBe('copy');
        expect(dropEffectFor('uninitialized')).toBe('copy');
    });

    test('gives way to a source that only allows a move, which is what the files tree says', () => {
        expect(dropEffectFor('move')).toBe('move');
        expect(dropEffectFor('linkMove')).toBe('move');
    });
});

describe('dropPoints', () => {
    test('puts the first on the point and the rest beside it', () => {
        expect(dropPoints({ x: 100, y: 40 }, 3, 560)).toEqual([
            { x: 100, y: 40 },
            { x: 660, y: 40 },
            { x: 1220, y: 40 }
        ]);
    });

    test('one file lands where it was let go of', () => {
        expect(dropPoints({ x: 10, y: 20 }, 1, 560)).toEqual([{ x: 10, y: 20 }]);
    });

    test('nothing dropped is nowhere to put it', () => {
        expect(dropPoints({ x: 10, y: 20 }, 0, 560)).toEqual([]);
    });
});
