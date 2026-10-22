import { afterEach, beforeEach, describe, expect, spyOn, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ServerFrame } from '@ruimte/contracts';
import type { CanvasHost } from '../canvas/verb.ts';
import { Dispatcher, type ClientAccess, type ClientConnection } from '../dispatcher.ts';
import { VoiceKeyStore } from '../voice/key-store.ts';
import { wireVoice } from '../wiring/voice.ts';
import { registerVoiceHandlers, type VoiceHandlerDeps } from './voice.ts';

const KEY = 'sk-test-voice-0123456789abcdef';
const OWNER: ClientAccess = { reachability: 'loopback', sessionId: null };
const PHONE: ClientAccess = { reachability: 'public', sessionId: 'phone-session' };
const PEER: ClientAccess = { reachability: 'public', sessionId: 'peer-session', peer: { machineId: 'machine-b' } };

let root: string;
let keys: VoiceKeyStore;
let started: string[];

function connection(id: string, access: ClientAccess): ClientConnection & { frames: ServerFrame[] } {
    const frames: ServerFrame[] = [];
    return { id, access, frames, send: (frame) => frames.push(frame) };
}

async function ask(dispatcher: Dispatcher, client: ClientConnection & { frames: ServerFrame[] }, type: string, payload: unknown) {
    await dispatcher.handle(client, JSON.stringify({ id: type, type, payload }));
    return client.frames.at(-1) as { ok: boolean; result?: unknown; error?: { code: string; message: string } };
}

function voiceDispatcher(keyHomeProblem: string | null = null): Dispatcher {
    const dispatcher = new Dispatcher();
    const sessions: VoiceHandlerDeps['sessions'] = {
        start: async (client, payload) => {
            started.push(`${client.id} ${payload.sceneId}`);
            return { sessionId: 'session-1', sdp: 'answer', status: { sessionId: 'session-1', sceneId: payload.sceneId, seq: 1, phase: 'active' } };
        },
        stop: async (client, payload) => ({ stopped: client.id === 'phone' && payload.sceneId === 'scene-1' }),
        confirm: async () => ({ accepted: false })
    };
    registerVoiceHandlers(dispatcher, { keys, sessions, keyHomeProblem });
    return dispatcher;
}

const START = { startId: 'start-1', sceneId: 'scene-1', projectId: 'project-1', sdp: 'v=0', language: 'en', voice: 'marin', timeZone: 'UTC' };

beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'ruimte-voice-handlers-'));
    keys = new VoiceKeyStore(root);
    started = [];
});

afterEach(async () => {
    await rm(root, { recursive: true, force: true });
});

describe('the voice requests', () => {
    test('only the local secret sets or clears the key, and anyone may ask whether one is set', async () => {
        const dispatcher = voiceDispatcher();
        const phone = connection('phone', PHONE);
        const owner = connection('owner', OWNER);
        expect(await ask(dispatcher, phone, 'voice.keyStatus', {})).toMatchObject({ ok: true, result: { present: false } });
        expect(await ask(dispatcher, phone, 'voice.setKey', { key: KEY })).toMatchObject({ ok: false, error: { code: 'forbidden' } });
        expect(await keys.has()).toBe(false);
        expect(await ask(dispatcher, owner, 'voice.setKey', { key: KEY })).toMatchObject({ ok: true, result: { present: true } });
        expect(await ask(dispatcher, phone, 'voice.keyStatus', {})).toMatchObject({ ok: true, result: { present: true } });
        expect(JSON.stringify(phone.frames)).not.toContain(KEY);
        expect(await ask(dispatcher, phone, 'voice.clearKey', {})).toMatchObject({ ok: false, error: { code: 'forbidden' } });
        expect(await ask(dispatcher, owner, 'voice.clearKey', {})).toMatchObject({ ok: true, result: { present: false } });
        expect(await keys.has()).toBe(false);
    });

    test('an installed or compiled daemon takes no key from the local secret either, as the CLI takes none there', async () => {
        await keys.write(KEY);
        const dispatcher = voiceDispatcher('Voice on the machine is a development spike');
        const owner = connection('owner', OWNER);
        expect(await ask(dispatcher, owner, 'voice.setKey', { key: KEY })).toMatchObject({ ok: false, error: { code: 'voice-dev-home-only' } });
        expect(await ask(dispatcher, owner, 'voice.clearKey', {})).toMatchObject({ ok: false, error: { code: 'voice-dev-home-only' } });
        expect(await keys.has()).toBe(true);
        expect(await ask(dispatcher, owner, 'voice.keyStatus', {})).toMatchObject({ ok: true, result: { present: true } });
        const log = spyOn(console, 'log').mockImplementation(() => undefined);
        try {
            const wired = (fields: { compiled: boolean; installedHome: string }) =>
                wireVoice({
                    config: { home: root, experimentalVoice: { enabled: true, writes: false } },
                    projects: { hold: () => undefined, letGo: () => undefined, index: { folderOf: () => null, viewsOf: () => null } } as never,
                    machine: { id: 'machine-1', label: 'Studio' },
                    canvasHost: {} as CanvasHost,
                    chats: { observe: () => () => undefined, get: () => undefined },
                    ...fields
                });
            expect(wired({ compiled: true, installedHome: join(root, '.ruimte') })!.keyHomeProblem).toContain('development spike');
            expect(wired({ compiled: false, installedHome: root })!.keyHomeProblem).toContain('development spike');
        } finally {
            log.mockRestore();
        }
    });

    test('a key that is refused is answered and logged without the key', async () => {
        const dispatcher = voiceDispatcher();
        const owner = connection('owner', OWNER);
        const error = spyOn(console, 'error').mockImplementation(() => undefined);
        try {
            const reply = await ask(dispatcher, owner, 'voice.setKey', { key: `${KEY} ${KEY}` });
            expect(reply).toMatchObject({ ok: false, error: { code: 'invalid-key' } });
            expect(JSON.stringify(reply)).not.toContain(KEY);
            expect(JSON.stringify(error.mock.calls)).not.toContain(KEY);
        } finally {
            error.mockRestore();
        }
    });

    test('another machine is refused before its payload is read, whatever it sends', async () => {
        const dispatcher = voiceDispatcher();
        const peer = connection('peer', PEER);
        for (const type of ['voice.keyStatus', 'voice.setKey', 'voice.start', 'voice.stop', 'voice.confirm']) {
            expect(await ask(dispatcher, peer, type, { not: 'a payload' })).toMatchObject({ ok: false, error: { code: 'forbidden' } });
        }
        expect(await ask(dispatcher, peer, 'voice.start', START)).toMatchObject({ ok: false, error: { code: 'forbidden' } });
        expect(started).toEqual([]);
    });

    test('a start and a stop reach the sessions with the connection they came on', async () => {
        const dispatcher = voiceDispatcher();
        const phone = connection('phone', PHONE);
        expect(await ask(dispatcher, phone, 'voice.start', START)).toMatchObject({ ok: true, result: { sessionId: 'session-1', sdp: 'answer' } });
        expect(started).toEqual(['phone scene-1']);
        expect(await ask(dispatcher, phone, 'voice.stop', { sceneId: 'scene-1', sessionId: 'session-1' })).toMatchObject({
            ok: true,
            result: { stopped: true }
        });
        expect(await ask(dispatcher, phone, 'voice.stop', { sceneId: 'scene-1', sessionId: 'session-1', startId: 'start-1' })).toMatchObject({
            ok: false,
            error: { code: 'bad-request' }
        });
    });

    test('without RUIMTE_EXPERIMENTAL_VOICE nothing is wired, so no client hears of Voice', () => {
        const off = wireVoice({
            config: { home: root, experimentalVoice: { enabled: false, writes: false } },
            projects: {} as never,
            machine: { id: 'machine-1', label: 'Studio' },
            canvasHost: {} as CanvasHost,
            chats: { observe: () => () => undefined, get: () => undefined },
            compiled: false
        });
        expect(off).toBeNull();
        const log = spyOn(console, 'log').mockImplementation(() => undefined);
        try {
            const on = wireVoice({
                config: { home: root, experimentalVoice: { enabled: true, writes: false } },
                projects: { hold: () => undefined, letGo: () => undefined, index: { folderOf: () => null, viewsOf: () => null } } as never,
                machine: { id: 'machine-1', label: 'Studio' },
                canvasHost: {} as CanvasHost,
                chats: { observe: () => () => undefined, get: () => undefined },
                compiled: false,
                installedHome: join(root, '.ruimte')
            });
            expect(on).not.toBeNull();
            expect(on!.keyHomeProblem).toBeNull();
            const dispatcher = new Dispatcher();
            registerVoiceHandlers(dispatcher, on!);
            expect(
                dispatcher
                    .types()
                    .filter((type) => type.startsWith('voice.'))
                    .sort()
            ).toEqual(['voice.clearKey', 'voice.confirm', 'voice.keyStatus', 'voice.setKey', 'voice.start', 'voice.stop']);
            expect(dispatcher.peerTypes().filter((type) => type.startsWith('voice.'))).toEqual([]);
        } finally {
            log.mockRestore();
        }
    });
});
