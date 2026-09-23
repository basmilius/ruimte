import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { H264_STREAM_CONTENT_TYPE, HEVC_STREAM_CONTENT_TYPE, LiveStreamDecoder } from '@ruimte/contracts';
import { AuthStore } from '../auth/auth-store.ts';
import { handleLiveStreamRequest, LIVE_STREAM_PATH } from './http-stream.ts';
import { LiveStreamHub } from './live-stream.ts';

const LOCAL_SECRET = 'the-local-secret';
const OPTIONS = { allowedOrigins: ['https://client.example'], localSecret: LOCAL_SECRET, tickets: { ticketSession: () => null } };

let root: string;
let auth: AuthStore;

beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'ruimte-live-stream-'));
    auth = new AuthStore(root);
});

afterEach(async () => {
    await rm(root, { recursive: true, force: true });
});

describe('the live stream route', () => {
    test('authenticates, frames bytes and releases the source when the reader leaves', async () => {
        const hub = new LiveStreamHub();
        let publish: ((frame: { sequence: number; width: number; height: number; data: Uint8Array }) => void) | null = null;
        let stopped = false;
        hub.register('browser:node-1', {
            async start(next) {
                publish = next;
            },
            async stop() {
                stopped = true;
            }
        });
        const url = new URL(`http://127.0.0.1:4210${LIVE_STREAM_PATH}/browser%3Anode-1`);
        const request = new Request(url, { headers: { authorization: `Bearer ${LOCAL_SECRET}` } });
        const response = await handleLiveStreamRequest(request, url, '127.0.0.1', auth, OPTIONS, hub);
        const reader = response.body!.getReader();
        const decoder = new LiveStreamDecoder();

        expect(response.status).toBe(200);
        expect(decoder.push((await reader.read()).value!)).toEqual([]);
        publish!({ sequence: 4, width: 320, height: 180, data: new Uint8Array([8, 9]) });
        expect(decoder.push((await reader.read()).value!)).toEqual([{ sequence: 4, width: 320, height: 180, data: new Uint8Array([8, 9]) }]);
        await reader.cancel();
        await Bun.sleep(0);
        expect(stopped).toBe(true);
    });

    test('refuses missing credentials and answers allowed preflights', async () => {
        const hub = new LiveStreamHub();
        const url = new URL(`http://127.0.0.1:4210${LIVE_STREAM_PATH}/missing`);
        expect((await handleLiveStreamRequest(new Request(url), url, '127.0.0.1', auth, OPTIONS, hub)).status).toBe(401);

        const preflight = new Request(url, { method: 'OPTIONS', headers: { origin: 'https://client.example' } });
        const response = await handleLiveStreamRequest(preflight, url, '127.0.0.1', auth, OPTIONS, hub);
        expect(response.status).toBe(204);
        expect(response.headers.get('access-control-allow-headers')).toBe('authorization');
    });

    test('announces an HEVC source without changing its bounded frame envelope', async () => {
        const hub = new LiveStreamHub();
        hub.register('device:phone-1', { format: 'hevc', async start() {}, async stop() {} });
        const url = new URL(`http://127.0.0.1:4210${LIVE_STREAM_PATH}/device%3Aphone-1`);
        const request = new Request(url, { headers: { authorization: `Bearer ${LOCAL_SECRET}` } });
        const response = await handleLiveStreamRequest(request, url, '127.0.0.1', auth, OPTIONS, hub);

        expect(response.headers.get('content-type')).toBe(HEVC_STREAM_CONTENT_TYPE);
        await response.body?.cancel();
    });

    test('skips a slow reader of a video to the next key frame instead of dropping one frame', async () => {
        const hub = new LiveStreamHub();
        let publish: ((frame: { sequence: number; width: number; height: number; data: Uint8Array; keyFrame: boolean }) => void) | null = null;
        let requests = 0;
        hub.register('device:pixel', {
            format: 'h264',
            async start(next) {
                publish = next;
            },
            async stop() {},
            requestKeyFrame() {
                requests += 1;
            }
        });
        const url = new URL(`http://127.0.0.1:4210${LIVE_STREAM_PATH}/device%3Apixel`);
        const request = new Request(url, { headers: { authorization: `Bearer ${LOCAL_SECRET}` } });
        const response = await handleLiveStreamRequest(request, url, '127.0.0.1', auth, OPTIONS, hub);
        const reader = response.body!.getReader();
        const decoder = new LiveStreamDecoder();
        const read = async (): Promise<number[]> => decoder.push((await reader.read()).value!).map((frame) => frame.sequence);

        expect(response.headers.get('content-type')).toBe(H264_STREAM_CONTENT_TYPE);
        expect(await read()).toEqual([]);
        for (const [sequence, keyFrame] of [
            [1, true],
            [2, false],
            [3, false],
            [4, false],
            [5, true]
        ] as const) {
            publish!({ sequence, width: 2, height: 2, data: new Uint8Array([sequence]), keyFrame });
        }
        expect(await read()).toEqual([1]);
        expect(await read()).toEqual([2]);
        publish!({ sequence: 6, width: 2, height: 2, data: new Uint8Array([6]), keyFrame: false });
        publish!({ sequence: 7, width: 2, height: 2, data: new Uint8Array([7]), keyFrame: true });
        expect(await read()).toEqual([7]);
        expect(requests).toBe(2);
        await reader.cancel();
    });

    test('refuses an authenticated stream when the machine disabled streaming', async () => {
        const hub = new LiveStreamHub();
        hub.register('browser:node-1', { async start() {}, async stop() {} });
        const url = new URL(`http://127.0.0.1:4210${LIVE_STREAM_PATH}/browser%3Anode-1`);
        const request = new Request(url, { headers: { authorization: `Bearer ${LOCAL_SECRET}` } });
        const response = await handleLiveStreamRequest(request, url, '127.0.0.1', auth, OPTIONS, hub, () => false);

        expect(response.status).toBe(403);
        expect(await response.text()).toContain('streaming is disabled');
    });
});
