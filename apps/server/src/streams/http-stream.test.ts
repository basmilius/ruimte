import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { LiveStreamDecoder } from '@ruimte/contracts';
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
});
