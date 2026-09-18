import { describe, expect, test } from 'bun:test';
import type { LiveStreamFrame } from '@ruimte/contracts';
import { PhysicalScreenshotSource } from './physical-screenshot-source.ts';

const frame = (sequence: number): LiveStreamFrame => ({ sequence, width: 1320, height: 2868, data: new Uint8Array([0xff, 0xd8, 0xff]) });

describe('PhysicalScreenshotSource', () => {
    test('publishes immediately, keeps refreshing and stops cleanly', async () => {
        const calls: number[] = [];
        const source = new PhysicalScreenshotSource(
            'physical-1',
            async (_deviceId, sequence) => {
                calls.push(sequence);
                return frame(sequence);
            },
            1
        );
        const frames: LiveStreamFrame[] = [];

        await source.start((next) => frames.push(next));
        await Bun.sleep(5);
        await source.stop();
        const countAfterStop = frames.length;
        await Bun.sleep(5);

        expect(frames[0]).toEqual(frame(0));
        expect(frames.length).toBeGreaterThan(1);
        expect(frames).toHaveLength(countAfterStop);
        expect(calls).toEqual(frames.map((next) => next.sequence));
    });

    test('reports that physical device input is unavailable', () => {
        const source = new PhysicalScreenshotSource('physical-1', async (_deviceId, sequence) => frame(sequence));

        expect(() => source.input({ kind: 'button', button: 'home' })).toThrow('Physical iOS devices are read-only');
    });
});
