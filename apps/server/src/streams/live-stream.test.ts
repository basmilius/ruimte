import { describe, expect, test } from 'bun:test';
import type { LiveStreamFrame } from '@ruimte/contracts';
import { LiveStreamHub, type LiveFrameSource } from './live-stream.ts';

const frame = (sequence: number): LiveStreamFrame => ({ sequence, width: 2, height: 2, data: new Uint8Array([sequence]) });

describe('LiveStreamHub', () => {
    test('reports the registered source format', () => {
        const hub = new LiveStreamHub();
        hub.register('device:one', { format: 'hevc', async start() {}, async stop() {} });

        expect(hub.format('device:one')).toBe('hevc');
        expect(hub.format('missing')).toBeNull();
    });

    test('asks a running video for a key frame when another viewer joins', async () => {
        let requests = 0;
        const hub = new LiveStreamHub();
        hub.register('device:pixel', {
            format: 'h264',
            async start() {},
            async stop() {},
            requestKeyFrame() {
                requests += 1;
            }
        });

        await hub.subscribe('device:pixel', () => undefined);
        expect(requests).toBe(0);
        await hub.subscribe('device:pixel', () => undefined);
        expect(requests).toBe(1);
    });

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
