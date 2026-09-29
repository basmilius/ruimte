import { describe, expect, test } from 'bun:test';
import type { LiveStreamFrame } from '@ruimte/contracts';
import { PhysicalScreenshotSource } from './physical-screenshot-source.ts';

const frame = (sequence: number): LiveStreamFrame => ({ sequence, width: 1320, height: 2868, data: new Uint8Array([0xff, 0xd8, 0xff]) });

describe('PhysicalScreenshotSource', () => {
    test('publishes immediately, keeps refreshing and stops cleanly', async () => {
        const calls: number[] = [];
        const pauses: (() => void)[] = [];
        const source = new PhysicalScreenshotSource(
            'physical-1',
            async (_deviceId, sequence) => {
                calls.push(sequence);
                return frame(sequence);
            },
            (_ms, signal) =>
                new Promise((resolve) => {
                    pauses.push(resolve);
                    signal.addEventListener('abort', () => resolve(), { once: true });
                })
        );
        const frames: LiveStreamFrame[] = [];
        const settle = async (): Promise<void> => {
            for (let i = 0; i < 5; i++) {
                await Promise.resolve();
            }
        };

        await source.start((next) => frames.push(next));
        expect(frames).toEqual([frame(0)]);

        await settle();
        pauses.shift()?.();
        await settle();
        expect(frames.map((next) => next.sequence)).toEqual([0, 1]);

        await source.stop();
        pauses.shift()?.();
        await settle();

        expect(frames).toHaveLength(2);
        expect(calls).toEqual([0, 1]);
    });

    test('reports that physical device input is unavailable', () => {
        const source = new PhysicalScreenshotSource('physical-1', async (_deviceId, sequence) => frame(sequence));

        expect(() => source.input({ kind: 'button', button: 'home' })).toThrow('Physical iOS devices are read-only');
    });
});
