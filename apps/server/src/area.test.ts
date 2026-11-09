import { describe, expect, test } from 'bun:test';
import { runStop, type Area } from './area.ts';

describe('runStop', () => {
    test('has run every halt step of every area before anything is awaited', async () => {
        const ran: string[] = [];
        const areas: Area[] = [
            {
                name: 'first',
                stop: [
                    { phase: 'drain', label: 'first drain', run: async () => void ran.push('first drain') },
                    { phase: 'halt', label: 'first halt', run: () => void ran.push('first halt') }
                ]
            },
            {
                name: 'second',
                stop: [
                    { phase: 'halt', label: 'second halt', run: () => void ran.push('second halt') },
                    { phase: 'last', label: 'second last', run: () => void ran.push('second last') }
                ]
            }
        ];

        const stopped = runStop(areas, () => undefined);

        // The first drain step starts synchronously too, but only after the last halt step ran.
        expect(ran.slice(0, 2)).toEqual(['first halt', 'second halt']);

        await stopped;

        expect(ran).toEqual(['first halt', 'second halt', 'first drain', 'second last']);
    });

    test('logs a failing step and still runs the next one', async () => {
        const failed: string[] = [];
        const ran: string[] = [];
        const areas: Area[] = [
            {
                name: 'only',
                stop: [
                    {
                        phase: 'halt',
                        label: 'broken halt',
                        run: () => {
                            throw new Error('halt failed');
                        }
                    },
                    { phase: 'halt', label: 'next halt', run: () => void ran.push('next halt') },
                    {
                        phase: 'drain',
                        label: 'broken drain',
                        run: async () => {
                            throw new Error('drain failed');
                        }
                    },
                    { phase: 'end', label: 'next end', run: () => void ran.push('next end') }
                ]
            }
        ];

        await runStop(areas, (label) => failed.push(label));

        expect(failed).toEqual(['broken halt', 'broken drain']);
        expect(ran).toEqual(['next halt', 'next end']);
    });

    test('refuses a halt step that returns a promise', () => {
        const area: Area = {
            name: 'late',
            // @ts-expect-error a halt step runs before anything is awaited, so it cannot hand back a promise
            stop: [{ phase: 'halt', label: 'async halt', run: async () => undefined }]
        };

        expect(area.stop).toHaveLength(1);
    });
});
