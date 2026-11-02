import { describe, expect, test } from 'bun:test';
import { oneAtATime } from './extension.ts';

describe('oneAtATime', () => {
    test('never starts a build while one runs, and builds once more after it for the saves that came meanwhile', async () => {
        const finishers: (() => void)[] = [];
        let runs = 0;
        let running = 0;
        let most = 0;
        const rebuild = oneAtATime(async () => {
            runs += 1;
            running += 1;
            most = Math.max(most, running);
            await new Promise<void>((resolve) => finishers.push(resolve));
            running -= 1;
        });

        const finishNext = async (): Promise<void> => {
            while (finishers.length === 0) {
                await new Promise((resolve) => setImmediate(resolve));
            }

            finishers.shift()?.();
        };

        const first = rebuild();

        void rebuild();
        void rebuild();
        await finishNext();
        await finishNext();
        await first;

        expect(runs).toBe(2);
        expect(most).toBe(1);
    });

    test('runs again once the last run settled, also after one that threw', async () => {
        let runs = 0;
        const rebuild = oneAtATime(async () => {
            runs += 1;

            if (runs === 1) {
                throw new Error('broken build');
            }
        });

        await expect(rebuild()).rejects.toThrow('broken build');
        await rebuild();

        expect(runs).toBe(2);
    });
});
