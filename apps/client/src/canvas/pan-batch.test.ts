import { describe, expect, test } from 'bun:test';
import { createPanBatch, type FrameClock } from './pan-batch';

const fakeClock = () => {
    const waiting = new Map<number, () => void>();
    let next = 1;
    const clock: FrameClock = {
        request: (callback) => {
            waiting.set(next, callback);
            return next++;
        },
        cancel: (handle) => {
            waiting.delete(handle);
        }
    };
    const tick = (): void => {
        const callbacks = [...waiting.values()];
        waiting.clear();
        for (const callback of callbacks) {
            callback();
        }
    };
    return { clock, tick, waiting };
};

describe('a pan batched per frame', () => {
    test('moves the camera once per frame by the sum of the wheel events', () => {
        const { clock, tick } = fakeClock();
        const moves: [number, number][] = [];
        const batch = createPanBatch((dx, dy) => moves.push([dx, dy]), clock);
        batch.add(1, 2);
        batch.add(3, 4);
        batch.add(-1, 0);
        expect(moves).toEqual([]);
        tick();
        expect(moves).toEqual([[3, 6]]);
        batch.add(5, 5);
        tick();
        expect(moves).toEqual([
            [3, 6],
            [5, 5]
        ]);
    });

    test('a flush applies what waits at once and leaves no frame behind', () => {
        const { clock, tick, waiting } = fakeClock();
        const moves: [number, number][] = [];
        const batch = createPanBatch((dx, dy) => moves.push([dx, dy]), clock);
        batch.add(2, 0);
        batch.flush();
        expect(moves).toEqual([[2, 0]]);
        expect(waiting.size).toBe(0);
        tick();
        batch.flush();
        expect(moves).toEqual([[2, 0]]);
    });
});
