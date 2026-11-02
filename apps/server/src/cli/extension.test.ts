import { describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { oneAtATime, watchAndBuild } from './extension.ts';

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

describe('watchAndBuild', () => {
    test('builds again for a save during the first build, and for no change of what a build or a tool keeps', async () => {
        const folder = mkdtempSync(join(tmpdir(), 'ruimte-watch-and-build-'));
        let listener: (name: string | null) => void = () => undefined;
        let builds = 0;

        mkdirSync(join(folder, 'client'));
        writeFileSync(join(folder, 'client', 'index.ts'), 'export {};');

        try {
            await watchAndBuild({
                folder,
                rebuild: async () => {
                    builds += 1;

                    if (builds === 1) {
                        writeFileSync(join(folder, 'client', 'index.ts'), 'export const saved = 1;');
                        listener('client/index.ts');
                    }
                },
                watch: (each) => {
                    listener = each;
                },
                debounce: (run) => run()
            });

            expect(builds).toBe(2);

            mkdirSync(join(folder, 'dist'));
            writeFileSync(join(folder, 'dist', 'index.js'), '');
            listener('dist/index.js');
            writeFileSync(join(folder, 'distribution.ts'), 'export {};');
            listener('distribution.ts');

            expect(builds).toBe(3);
        } finally {
            rmSync(folder, { recursive: true, force: true });
        }
    });
});
