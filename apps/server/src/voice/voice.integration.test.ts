import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import type { ServerWebSocket } from 'bun';
import type { ChatItem, ProjectContent, ProjectSummary } from '@ruimte/contracts';
import type { LiveEvent } from '@ruimte/voice';
import { serverActions } from '../actions/server-actions.ts';
import type { CanvasHost } from '../canvas/verb.ts';
import { connectionOpener, socketChannel, type ConnectionServices, type SocketChannel, type OpenConnection } from '../connection.ts';
import { Dispatcher, type ClientAccess } from '../dispatcher.ts';
import { registerVoiceHandlers } from '../handlers/voice.ts';
import { SYSTEM_CLOCK } from './clock.ts';
import { VoiceKeyStore } from './key-store.ts';
import { openAiLive } from './openai-live.ts';
import { VoicePreferencesStore } from './preferences-store.ts';
import { FakeChats } from './voice-fakes.ts';
import { VoiceSessions } from './voice-sessions.ts';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/*
 * The whole route over real sockets: a client asks the daemon's socket, the daemon mints and attaches with
 * the real GPT-Live client, and a fake OpenAI on loopback plays the service, tool call and close included.
 */

const KEY = 'sk-test-voice-0123456789abcdef';

const CONTENT = {
    views: [{ id: 'main', kind: 'canvas', name: 'Main', nodes: [{ id: 'chat-1', kind: 'chat', title: 'Builder', x: 0, y: 0, w: 400, h: 300 }], edges: [] }]
} as unknown as ProjectContent;

interface FakeOpenAi {
    url: string;
    mints: { authorization: string | null; body: Record<string, unknown> }[];
    attaches: string[];
    received: LiveEvent[];
    sockets: ServerWebSocket<{ sessionId: string }>[];
    stop(): void;
}

function fakeOpenAi(): FakeOpenAi {
    const fake: Omit<FakeOpenAi, 'url' | 'stop'> = { mints: [], attaches: [], received: [], sockets: [] };
    const server = Bun.serve<{ sessionId: string }>({
        hostname: '127.0.0.1',
        port: 0,
        async fetch(request, upgrading) {
            const url = new URL(request.url);
            const authorization = request.headers.get('authorization');
            if (request.method === 'POST' && url.pathname === '/v1/live/sessions') {
                fake.mints.push({ authorization, body: (await request.json()) as Record<string, unknown> });
                if (authorization !== `Bearer ${KEY}`) {
                    return new Response('{}', { status: 401 });
                }
                return Response.json({ session: { id: `sess_${fake.mints.length}` }, transport: { type: 'webrtc', sdp: 'v=0 answer' } });
            }
            const attach = /^\/v1\/live\/sessions\/([A-Za-z0-9_-]+)\/attach$/.exec(url.pathname);
            if (attach && authorization === `Bearer ${KEY}` && upgrading.upgrade(request, { data: { sessionId: attach[1]! } })) {
                return undefined;
            }
            return new Response('not found', { status: 404 });
        },
        websocket: {
            open(ws) {
                fake.attaches.push(ws.data.sessionId);
                fake.sockets.push(ws);
            },
            message(ws, message) {
                const event = JSON.parse(String(message)) as LiveEvent;
                fake.received.push(event);
                if (event.type === 'session.close') {
                    ws.send(JSON.stringify({ type: 'session.closed' }));
                }
            }
        }
    });
    return { ...fake, url: `http://127.0.0.1:${server.port}`, stop: () => void server.stop(true) };
}

function source() {
    return { subscribe: () => () => undefined, detachAll: () => undefined };
}

interface Daemon {
    url: string;
    sessions: VoiceSessions;
    stop(): void;
}

function daemon(home: string, openAiUrl: string, threads: Map<string, ChatItem[]>, holds: string[]): Daemon {
    const host = {
        projects: {
            locate: (id: string) => (id === 'chat-1' ? { projectId: 'project-1', folder: '/work/app', canvasId: 'main' } : null),
            machineOfNode: () => null,
            read: async () => CONTENT
        },
        chatThreads: { items: async (chatId: string) => threads.get(chatId) ?? null }
    } as unknown as CanvasHost;
    const preferences = new VoicePreferencesStore(home);
    const sessions = new VoiceSessions({
        live: openAiLive({ baseUrl: openAiUrl }),
        key: () => new VoiceKeyStore(home).read(),
        preferences: () => preferences.get(),
        clock: SYSTEM_CLOCK,
        holds: {
            hold: (holder, projectId) => holds.push(`hold ${holder} ${projectId}`),
            letGo: (holder, projectId) => holds.push(`letGo ${holder} ${projectId}`)
        },
        runner: serverActions,
        host,
        chats: new FakeChats(),
        index: { folderOf: (projectId) => (projectId === 'project-1' ? '/work/app' : null), viewsOf: () => CONTENT.views },
        projects: {
            list: async () => [
                {
                    projectId: 'project-1',
                    name: 'App',
                    color: '#123456',
                    folder: '/work/app',
                    lastOpenedAt: 1,
                    closedAt: null,
                    available: true,
                    icon: { kind: 'lucide', value: 'folder' },
                    nameSource: 'folder'
                } as ProjectSummary
            ]
        },
        machine: { id: 'machine-1', label: 'Studio' }
    });
    const dispatcher = new Dispatcher();
    registerVoiceHandlers(dispatcher, { keys: new VoiceKeyStore(home), preferences, sessions });
    const services = {
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
        voice: sessions,
        voicePreferences: preferences
    } as unknown as ConnectionServices;
    const open = connectionOpener(services);
    const sockets = new Map<ServerWebSocket<ClientAccess>, { channel: SocketChannel; connection: OpenConnection }>();
    const server = Bun.serve<ClientAccess>({
        hostname: '127.0.0.1',
        port: 0,
        fetch(request, upgrading) {
            return upgrading.upgrade(request, { data: { reachability: 'loopback', sessionId: 'phone-session' } })
                ? undefined
                : new Response('no', { status: 400 });
        },
        websocket: {
            open(ws) {
                const channel = socketChannel(ws);
                sockets.set(ws, { channel, connection: open(channel, ws.data) });
            },
            message(ws, message) {
                sockets.get(ws)?.connection.receive(message);
            },
            close(ws) {
                const state = sockets.get(ws);
                sockets.delete(ws);
                state?.channel.closed();
            }
        }
    });
    return { url: `ws://127.0.0.1:${server.port}/ws`, sessions, stop: () => void server.stop(true) };
}

/* A phone's link to the daemon: requests answered by id, and every event it heard. */
async function phone(url: string) {
    const socket = new WebSocket(url);
    const replies = new Map<string, (frame: { ok: boolean; result?: unknown; error?: { code: string } }) => void>();
    const events: { event: string; payload: Record<string, unknown> }[] = [];
    socket.addEventListener('message', (message) => {
        const frame = JSON.parse(String(message.data));
        if (frame.type === 'event') {
            events.push({ event: frame.event, payload: frame.payload });
        } else {
            replies.get(frame.id)?.(frame);
        }
    });
    await new Promise((resolve) => socket.addEventListener('open', resolve, { once: true }));
    let next = 0;
    return {
        events,
        socket,
        ask(type: string, payload: unknown): Promise<{ ok: boolean; result?: unknown; error?: { code: string } }> {
            const id = `r${++next}`;
            return new Promise((resolve) => {
                replies.set(id, resolve);
                socket.send(JSON.stringify({ id, type, payload }));
            });
        }
    };
}

async function until(check: () => boolean): Promise<void> {
    for (let i = 0; i < 200 && !check(); i++) {
        await Bun.sleep(10);
    }
    expect(check()).toBe(true);
}

let root: string;
let openAi: FakeOpenAi;
let running: Daemon;
let threads: Map<string, ChatItem[]>;
let holds: string[];

beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'ruimte-voice-route-'));
    openAi = fakeOpenAi();
    threads = new Map();
    holds = [];
    running = daemon(root, openAi.url, threads, holds);
});

afterEach(async () => {
    running.stop();
    openAi.stop();
    await rm(root, { recursive: true, force: true });
});

// The phone names no project, so the session starts in the one opened last.
const START = { startId: 'start-1', sceneId: 'scene-1', sdp: 'v=0 offer', language: 'en', voice: 'marin', timeZone: 'UTC' };

describe('Voice run by the daemon over real sockets', () => {
    test('starts, runs a tool, reports and stops', async () => {
        await new VoiceKeyStore(root).write(KEY);
        threads.set('chat-1', [{ id: 'u1', kind: 'user', createdAt: 1, turnId: 't1', text: 'Build the login page' } as ChatItem]);
        const client = await phone(running.url);

        const started = await client.ask('voice.start', START);
        expect(started).toMatchObject({ ok: true, result: { sdp: 'v=0 answer', status: { phase: 'active', project: { id: 'project-1', name: 'App' } } } });
        const sessionId = (started.result as { sessionId: string }).sessionId;
        expect(openAi.mints).toHaveLength(1);
        expect(openAi.mints[0]!.authorization).toBe(`Bearer ${KEY}`);
        expect(JSON.stringify(openAi.mints[0]!.body)).toContain('chat.read');
        expect(openAi.attaches).toEqual(['sess_1']);
        expect(holds).toEqual([`hold voice:${sessionId} project-1`]);

        openAi.sockets[0]!.send(JSON.stringify({ type: 'session.input_audio.append', audio: 'QUJDRA==' }));
        openAi.sockets[0]!.send(
            JSON.stringify({
                type: 'response.event',
                delegation_id: 'delegation-1',
                event: {
                    type: 'response.output_item.done',
                    item: {
                        type: 'function_call',
                        call_id: 'call-1',
                        name: 'communicate',
                        arguments: JSON.stringify({ action: 'chat.read', chatId: 'chat-1', limit: null })
                    }
                }
            })
        );
        openAi.sockets[0]!.send(JSON.stringify({ type: 'response.event', delegation_id: 'delegation-1', event: { type: 'response.completed' } }));
        await until(() => openAi.received.some((event) => event.type === 'response.create'));
        const output = openAi.received.find((event) => event.type === 'response.item.create')!;
        expect(JSON.parse(String((output.item as { output: string }).output))).toMatchObject({
            ok: true,
            chat: 'Builder',
            messages: [{ role: 'user', text: 'Build the login page' }]
        });
        await until(() => client.events.filter((event) => event.event === 'voice.activity').length === 2);

        expect(await client.ask('voice.stop', { sceneId: 'scene-1', sessionId })).toMatchObject({ ok: true, result: { stopped: true } });
        expect(openAi.received.filter((event) => event.type === 'session.close')).toHaveLength(1);
        await until(() => client.events.some((event) => event.event === 'voice.status' && event.payload.phase === 'closed'));
        expect(holds.at(-1)).toBe(`letGo voice:${sessionId} project-1`);
        // Nothing the phone heard carries the key or the echoed audio.
        expect(JSON.stringify(client.events)).not.toContain(KEY);
        expect(JSON.stringify(client.events)).not.toContain('QUJDRA==');
        client.socket.close();
    });

    test('a start without a key mints nothing, and a link that goes ends its session at OpenAI', async () => {
        const client = await phone(running.url);
        expect(await client.ask('voice.start', START)).toMatchObject({ ok: false, error: { code: 'voice-no-key' } });
        expect(openAi.mints).toEqual([]);

        await new VoiceKeyStore(root).write(KEY);
        expect(await client.ask('voice.start', { ...START, startId: 'start-2' })).toMatchObject({ ok: true });
        client.socket.close();
        await until(() => openAi.received.some((event) => event.type === 'session.close'));
        await until(() => running.sessions.size === 0);
    });
});
