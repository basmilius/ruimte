import { describe, expect, test } from 'bun:test';
import type { LiveStreamFrame } from '@ruimte/contracts';
import { LiveStreamHub, type LiveFrameSource } from './live-stream.ts';

const frame = (sequence: number): LiveStreamFrame => ({ sequence, width: 2, height: 2, data: new Uint8Array([sequence]) });

describe('LiveStreamHub', () => {
    test('starts on the first viewer and stops after the last one', async () => {
        let publish: ((next: LiveStreamFrame) => void) | null = null;
        let starts = 0;
        let stops = 0;
        const source: LiveFrameSource = {
            async start(next) {
                starts += 1;
                publish = next;
            },
            async stop() {
                stops += 1;
            }
        };
        const hub = new LiveStreamHub();
        hub.register('browser:one', source);
        const first: number[] = [];
        const second: number[] = [];
        const offFirst = await hub.subscribe('browser:one', (next) => first.push(next.sequence));
        const offSecond = await hub.subscribe('browser:one', (next) => second.push(next.sequence));

        publish!(frame(1));
        expect(starts).toBe(1);
        expect(first).toEqual([1]);
        expect(second).toEqual([1]);
        offFirst();
        expect(stops).toBe(0);
        offSecond();
        await Bun.sleep(0);
        expect(stops).toBe(1);
    });
});
