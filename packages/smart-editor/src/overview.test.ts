import { describe, expect, test } from 'bun:test';
import { overviewTicks } from './overview.ts';

describe('overviewTicks', () => {
    test('scales the content onto the track and gives a tick at least three pixels', () => {
        expect(overviewTicks([{ kind: 'added', top: 1000, bottom: 1020 }], 2000, 200)).toEqual([{ kind: 'added', y: 100, height: 3 }]);
        expect(overviewTicks([{ kind: 'modified', top: 0, bottom: 400 }], 2000, 200)).toEqual([{ kind: 'modified', y: 0, height: 40 }]);
    });

    test('does not stretch a document shorter than the track', () => {
        expect(overviewTicks([{ kind: 'added', top: 40, bottom: 60 }], 100, 400)).toEqual([{ kind: 'added', y: 40, height: 20 }]);
    });

    test('joins ticks of one kind that touch and keeps those of another kind apart', () => {
        const ticks = overviewTicks(
            [
                { kind: 'find', top: 0, bottom: 20 },
                { kind: 'find', top: 20, bottom: 40 },
                { kind: 'find-current', top: 20, bottom: 40 },
                { kind: 'find', top: 400, bottom: 420 }
            ],
            1000,
            1000
        );
        expect(ticks).toEqual([
            { kind: 'find', y: 0, height: 40 },
            { kind: 'find-current', y: 20, height: 20 },
            { kind: 'find', y: 400, height: 20 }
        ]);
    });

    test('has nothing to draw in a track without height', () => {
        expect(overviewTicks([{ kind: 'added', top: 0, bottom: 20 }], 100, 0)).toEqual([]);
    });
});
