import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ServerFrame } from '@ruimte/contracts';
import { AuthStore } from '../auth/auth-store.ts';
import { Dispatcher, type ClientAccess, type ClientConnection } from '../dispatcher.ts';
import { registerAuthHandlers } from './auth.ts';

let home: string;
let store: AuthStore;
let dispatcher: Dispatcher;
let minted: number;
let disconnected: string[];

const client = (access?: ClientAccess): { connection: ClientConnection; frames: ServerFrame[] } => {
    const frames: ServerFrame[] = [];
    return {
        frames,
        connection: {
            id: 'c1',
            access,
            send(frame) {
                frames.push(frame);
            }
        }
    };
};

const ask = async (access: ClientAccess | undefined, type: string, payload: unknown = {}): Promise<ServerFrame> => {
    const { connection, frames } = client(access);
    await dispatcher.handle(connection, JSON.stringify({ id: '1', type, payload }));
    return frames[0]!;
};

beforeEach(async () => {
    home = await mkdtemp(join(tmpdir(), 'ruimte-auth-handlers-'));
    store = new AuthStore(home);
    dispatcher = new Dispatcher();
    minted = 0;
    disconnected = [];
    registerAuthHandlers(dispatcher, store, {
        label: 'box',
        version: '0.0.0',
        pairingUrl: () => `http://box:4210/pair#${store.issuePairingToken()}${minted++}`,
        disconnect: (sessionId) => disconnected.push(sessionId)
    });
});

afterEach(async () => {
    await rm(home, { recursive: true, force: true });
});

describe('auth handlers', () => {
    test('a loopback client gets a pairing link, a paired remote one does not', async () => {
        const local = await ask({ reachability: 'loopback', sessionId: null }, 'auth.pairingToken');
        expect(local).toMatchObject({ ok: true, result: { url: expect.stringMatching(/^http:\/\/box:4210\/pair#/) } });
        // A test client without access is the daemon's own process, which counts as loopback.
        expect(await ask(undefined, 'auth.pairingToken')).toMatchObject({ ok: true });

        const remote = await ask({ reachability: 'lan', sessionId: 's1' }, 'auth.pairingToken');
        expect(remote).toMatchObject({ ok: false, error: { code: 'forbidden' } });
        expect(minted).toBe(2);
    });

    test('sessions list the asking client as current, and revoking an unknown one is an error', async () => {
        const paired = await store.pair(store.issuePairingToken(), 'laptop');
        const listed = await ask({ reachability: 'lan', sessionId: paired!.id }, 'auth.sessions');
        expect(listed).toMatchObject({ ok: true, result: { sessions: [{ id: paired!.id, label: 'laptop', current: true }] } });

        const loopback: ClientAccess = { reachability: 'loopback', sessionId: null };
        expect(await ask(loopback, 'auth.revoke', { id: 'nope' })).toMatchObject({ ok: false, error: { code: 'session-not-found' } });
        expect(await ask(loopback, 'auth.revoke', { id: paired!.id })).toMatchObject({ ok: true });
        expect(await store.list(null)).toEqual([]);
        expect(disconnected).toEqual([paired!.id]);
    });
});
