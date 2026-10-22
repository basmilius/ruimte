import { afterEach, beforeEach, describe, expect, spyOn, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ServerFrame } from '@ruimte/contracts';
import type { CanvasHost } from '../canvas/verb.ts';
import { connectionOpener, type ClientChannel, type ConnectionServices } from '../connection.ts';
import { Dispatcher, type ClientAccess, type ClientConnection } from '../dispatcher.ts';
import { VoiceKeyStore } from '../voice/key-store.ts';
import { VoicePreferencesStore } from '../voice/preferences-store.ts';
import { wireVoice } from '../wiring/voice.ts';
import { registerVoiceHandlers, type VoiceHandlerDeps } from './voice.ts';

const KEY = 'sk-test-voice-0123456789abcdef';
const OWNER: ClientAccess = { reachability: 'loopback', sessionId: null };
const PHONE: ClientAccess = { reachability: 'public', sessionId: 'phone-session' };
const PEER: ClientAccess = { reachability: 'public', sessionId: 'peer-session', peer: { machineId: 'machine-b' } };

let root: string;
let keys: VoiceKeyStore;
let preferences: VoicePreferencesStore;
let started: string[];

function connection(id: string, access: ClientAccess): ClientConnection & { frames: ServerFrame[] } {
    const frames: ServerFrame[] = [];
    return { id, access, frames, send: (frame) => frames.push(frame) };
}

async function ask(dispatcher: Dispatcher, client: ClientConnection & { frames: ServerFrame[] }, type: string, payload: unknown) {
    await dispatcher.handle(client, JSON.stringify({ id: type, type, payload }));
    return client.frames.at(-1) as { ok: boolean; result?: unknown; error?: { code: string; message: string } };
}

function voiceDispatcher(): Dispatcher {
    const dispatcher = new Dispatcher();
    const sessions: VoiceHandlerDeps['sessions'] = {
        start: async (client, payload) => {
            started.push(`${client.id} ${payload.sceneId}`);
            return { sessionId: 'session-1', sdp: 'answer', status: { sessionId: 'session-1', sceneId: payload.sceneId, seq: 1, phase: 'active' } };
        },
        stop: async (client, payload) => ({ stopped: client.id === 'phone' && payload.sceneId === 'scene-1' }),
        confirm: async () => ({ accepted: false })
    };
    registerVoiceHandlers(dispatcher, { keys, preferences, sessions });
    return dispatcher;
}

/* A channel the opener sends whole frames into, for a test of what each client hears. */
function channel(): ClientChannel & { frames: ServerFrame[] } {
    const frames: ServerFrame[] = [];
    return {
        frames,
        send: (data) => {
            frames.push(JSON.parse(String(data)) as ServerFrame);
            return 1;
        },
        bufferedAmount: () => 0,
        close: () => undefined,
        onClose: () => undefined,
        onDrain: () => undefined
    };
}

function heard(frames: ServerFrame[], event: string): unknown[] {
    return frames.flatMap((frame) => ('type' in frame && frame.type === 'event' && frame.event === event ? [frame.payload] : []));
}

const START = { startId: 'start-1', sceneId: 'scene-1', projectId: 'project-1', sdp: 'v=0', language: 'en', voice: 'marin', timeZone: 'UTC' };

beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'ruimte-voice-handlers-'));
    keys = new VoiceKeyStore(root);
    preferences = new VoicePreferencesStore(root);
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

    test('the home an installed Ruimte uses takes the key from the local secret too', async () => {
        const home = join(root, '.ruimte');
        const wired = wireVoice({
            config: { home },
            projects: { hold: () => undefined, letGo: () => undefined, index: { folderOf: () => null, viewsOf: () => null } } as never,
            machine: { id: 'machine-1', label: 'Studio' },
            canvasHost: {} as CanvasHost,
            chats: { observe: () => () => undefined, get: () => undefined }
        });
        const dispatcher = new Dispatcher();
        registerVoiceHandlers(dispatcher, wired);
        const owner = connection('owner', OWNER);
        expect(await ask(dispatcher, owner, 'voice.setKey', { key: KEY })).toMatchObject({ ok: true, result: { present: true } });
        expect(await new VoiceKeyStore(home).read()).toBe(KEY);
        expect(await ask(dispatcher, owner, 'voice.clearKey', {})).toMatchObject({ ok: true, result: { present: false } });
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

    test('is wired without any variable and says nothing at start, and no request is a peer’s', () => {
        const log = spyOn(console, 'log').mockImplementation(() => undefined);
        try {
            const wired = wireVoice({
                config: { home: root },
                projects: { hold: () => undefined, letGo: () => undefined, index: { folderOf: () => null, viewsOf: () => null } } as never,
                machine: { id: 'machine-1', label: 'Studio' },
                canvasHost: {} as CanvasHost,
                chats: { observe: () => () => undefined, get: () => undefined }
            });
            expect(log).not.toHaveBeenCalled();
            const dispatcher = new Dispatcher();
            registerVoiceHandlers(dispatcher, wired);
            expect(
                dispatcher
                    .types()
                    .filter((type) => type.startsWith('voice.'))
                    .sort()
            ).toEqual([
                'voice.clearKey',
                'voice.confirm',
                'voice.keyStatus',
                'voice.preferences',
                'voice.setKey',
                'voice.setPreferences',
                'voice.start',
                'voice.stop'
            ]);
            expect(dispatcher.peerTypes().filter((type) => type.startsWith('voice.'))).toEqual([]);
        } finally {
            log.mockRestore();
        }
    });
});

describe('the preferences of Voice', () => {
    test('any client but another machine reads and sets them, and only what the lists hold', async () => {
        const dispatcher = voiceDispatcher();
        const phone = connection('phone', PHONE);
        const peer = connection('peer', PEER);
        expect(await ask(dispatcher, phone, 'voice.preferences', {})).toMatchObject({ ok: true, result: { preferences: null } });
        expect(await ask(dispatcher, phone, 'voice.setPreferences', { language: 'nl', voice: 'cedar' })).toMatchObject({
            ok: true,
            result: { preferences: { language: 'nl', voice: 'cedar' } }
        });
        expect(await ask(dispatcher, phone, 'voice.setPreferences', { language: 'klingon', voice: 'cedar' })).toMatchObject({
            ok: false,
            error: { code: 'bad-request' }
        });
        expect(await ask(dispatcher, phone, 'voice.setPreferences', { language: 'nl' })).toMatchObject({ ok: false, error: { code: 'bad-request' } });
        for (const [type, payload] of [
            ['voice.preferences', {}],
            ['voice.setPreferences', { language: 'de', voice: 'marin' }]
        ] as const) {
            expect(await ask(dispatcher, peer, type, payload)).toMatchObject({ ok: false, error: { code: 'forbidden' } });
        }
        expect(await ask(dispatcher, phone, 'voice.preferences', {})).toMatchObject({ result: { preferences: { language: 'nl', voice: 'cedar' } } });
        expect(new VoicePreferencesStore(root).get()).toEqual({ language: 'nl', voice: 'cedar' });
    });

    test('a change goes to every client of the machine, and to no other machine', async () => {
        const dispatcher = voiceDispatcher();
        const source = () => ({ subscribe: () => () => undefined, detachAll: () => undefined });
        const open = connectionOpener({
            dispatcher,
            sessions: { ...source(), get: () => undefined },
            chats: source(),
            identity: source(),
            projects: source(),
            drawings: source(),
            diagrams: source(),
            folders: source(),
            statuses: source(),
            usage: source(),
            limits: source(),
            processes: source(),
            voicePreferences: preferences
        } as unknown as ConnectionServices);
        const phone = channel();
        const desktop = channel();
        const peer = channel();
        const asking = open(phone, PHONE);
        open(desktop, OWNER);
        open(peer, PEER);
        asking.receive(JSON.stringify({ id: 'set', type: 'voice.setPreferences', payload: { language: 'ja', voice: 'marin' } }));
        for (let i = 0; i < 100 && !phone.frames.some((frame) => 'id' in frame && frame.id === 'set'); i++) {
            await Promise.resolve();
        }
        const change = { preferences: { language: 'ja', voice: 'marin' } };
        expect(heard(phone.frames, 'voice.preferences')).toEqual([change]);
        expect(heard(desktop.frames, 'voice.preferences')).toEqual([change]);
        expect(heard(peer.frames, 'voice.preferences')).toEqual([]);
    });
});
