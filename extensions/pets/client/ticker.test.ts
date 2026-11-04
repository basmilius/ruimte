import { afterEach, beforeEach, describe, expect, jest, test } from 'bun:test';
import { onPetTick, PET_TICK_MS } from '@extensions/pets/client/ticker';

beforeEach(() => {
    jest.useFakeTimers();
});

afterEach(() => {
    jest.useRealTimers();
});

describe('the pets beat', () => {
    test('lands on the grid of the document clock, whenever the first pet came', () => {
        let beats = 0;
        jest.advanceTimersByTime(50);
        const stop = onPetTick(() => {
            beats += 1;
        });
        const counted: number[] = [];

        for (const step of [PET_TICK_MS - 51, 1, PET_TICK_MS - 1, 1]) {
            jest.advanceTimersByTime(step);
            counted.push(beats);
        }

        stop();

        expect(counted).toEqual([1, 2, 2, 3]);
    });

    test('stops once the last pet leaves, also when it leaves on a beat', () => {
        let beats = 0;
        const stop = onPetTick(() => {
            beats += 1;
            if (beats === 2) {
                stop();
            }
        });

        jest.advanceTimersByTime(PET_TICK_MS * 4);

        expect(beats).toBe(2);
        expect(jest.getTimerCount()).toBe(0);
    });
});
