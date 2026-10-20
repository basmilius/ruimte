import { beforeEach, describe, expect, test } from 'bun:test';
import type { ChatItem, ProjectContent, ServerFrame, VoiceStartPayload } from '@ruimte/contracts';
import type { LiveEvent } from '@ruimte/voice';
import type { CanvasHost } from '../canvas/verb.ts';
import type { ClientConnection } from '../dispatcher.ts';
import { serverActions } from '../actions/server-actions.ts';
import { LiveError } from './openai-live.ts';
import { FakeClock, FakeLive, settle } from './voice-fakes.ts';
import { VOICE_START_DEADLINE_MS } from './voice-session.ts';
import { MAX_VOICE_SESSIONS, VoiceSessions } from './voice-sessions.ts';

const KEY = 'sk-test-voice-0123456789abcdef';

const CONTENT = {
    views: [
        { id: 'main', kind: 'canvas', name: 'Main', nodes: [{ id: 'chat-1', kind: 'chat', title: 'Builder', x: 0, y: 0, w: 400, h: 300 }], edges: [] },
        { id: 'second', kind: 'canvas', name: 'Second', nodes: [], edges: [] }
    ]
} as unknown as ProjectContent;

interface FakeClient extends ClientConnection {
    frames: ServerFrame[];
    closed: boolean;
}

function client(id: string): FakeClient {
    const frames: ServerFrame[] = [];
    return {
        id,
        frames,
        closed: false,
        send: (frame) => frames.push(frame)
    };
}

function eventsOf(target: FakeClient, name?: string): { event: string; payload: Record<string, unknown> }[] {
    return target.frames
        .filter((frame): frame is Extract<ServerFrame, { type: 'event' }> => 'type' in frame && frame.type === 'event')
        .map((frame) => ({ event: frame.event, payload: frame.payload as Record<string, unknown> }))
        .filter((frame) => name === undefined || frame.event === name);
}

function phases(target: FakeClient): string[] {
    return eventsOf(target, 'voice.status').map((frame) => String(frame.payload.phase));
}

function startPayload(fields: Partial<VoiceStartPayload> = {}): VoiceStartPayload {
    return {
        startId: 'start-1',
        sceneId: 'scene-1',
        projectId: 'project-1',
        sdp: 'v=0 offer',
        language: 'en',
        voice: 'marin',
        timeZone: 'Europe/Amsterdam',
        ...fields
    } as VoiceStartPayload;
}

function functionCall(callId: string, args: Record<string, unknown>, delegation = 'delegation-1'): LiveEvent {
    return {
        type: 'response.event',
        delegation_id: delegation,
        event: { type: 'response.output_item.done', item: { type: 'function_call', call_id: callId, name: 'communicate', arguments: JSON.stringify(args) } }
    };
}

let clock: FakeClock;
let live: FakeLive;
let key: string | null;
let holds: string[];
let threads: Map<string, ChatItem[]>;
// What a read of a thread waits on, so a test can hold a tool call in flight.
let threadGate: Promise<void>;
let ids: number;

function sessions(writes = false): VoiceSessions {
    const host = {
        projects: {
            locate: (id: string) => (id === 'chat-1' ? { projectId: 'project-1', folder: '/work/app', canvasId: 'main' } : null),
            machineOfNode: () => null,
            read: async () => CONTENT
        },
        chatThreads: {
            items: async (chatId: string) => {
                await threadGate;
                return threads.get(chatId) ?? null;
            }
        }
    } as unknown as CanvasHost;
    return new VoiceSessions({
        live,
        key: async () => key,
        clock,
        holds: {
            hold: (holder, projectId) => holds.push(`hold ${holder} ${projectId}`),
            letGo: (holder, projectId) => holds.push(`letGo ${holder} ${projectId}`)
        },
        runner: serverActions,
        host,
        index: {
            folderOf: (projectId) => (projectId === 'project-1' ? '/work/app' : null),
            viewsOf: (projectId) => (projectId === 'project-1' ? CONTENT.views : null)
        },
        writes,
        newId: () => `session-${++ids}`
    });
}

/* A start answered all the way through, and what it left to drive. */
async function started(voice: VoiceSessions, owner = client('client-1'), payload = startPayload()) {
    const answer = voice.start(owner, payload);
    await settle();
    const sessionId = live.answerMint();
    await settle();
    const attach = live.answerAttach();
    const result = await answer;
    return { owner, result, sessionId, attach };
}

beforeEach(() => {
    clock = new FakeClock();
    live = new FakeLive(clock);
    key = KEY;
    holds = [];
    threads = new Map();
    threadGate = Promise.resolve();
    ids = 0;
});

describe('starting', () => {
    test('answers the offer only once the sideband is attached, and holds the project meanwhile', async () => {
        const voice = sessions();
        const owner = client('client-1');
        let answered = false;
        const answer = voice.start(owner, startPayload()).then((result) => {
            answered = true;
            return result;
        });
        await settle();
        expect(live.mints).toHaveLength(1);
        expect(live.mints[0]!.key).toBe(KEY);
        expect(holds).toEqual(['hold voice:session-1 project-1']);
        live.answerMint();
        await settle();
        expect(live.attaches).toHaveLength(1);
        expect(answered).toBe(false);
        live.answerAttach();
        const result = await answer;
        expect(result).toEqual({
            sessionId: 'session-1',
            sdp: 'answer-of-live_1',
            status: { sessionId: 'session-1', sceneId: 'scene-1', seq: 1, phase: 'active' }
        });
        expect(phases(owner)).toEqual(['active']);
        expect(clock.pending).toBe(0);
    });

    test('mints with the phone prompt and only the read tools without the writes grant', async () => {
        const voice = sessions(false);
        void voice.start(client('client-1'), startPayload());
        await settle();
        const body = live.mints[0]!.body as {
            session: { instructions: string; delegation: { responses: { tools: { name: string; parameters: unknown }[]; instructions: string } } };
        };
        const tools = body.session.delegation.responses.tools;
        const actions = JSON.stringify(tools.map((tool) => tool.parameters));
        expect(actions).toContain('chat.read');
        expect(actions).not.toContain('chat.send');
        expect(body.session.delegation.responses.instructions).toContain('only reads for now');
        expect(body.session.delegation.responses.instructions).toContain('There is no selection, no split cells and no camera on a phone');
        expect(JSON.stringify(body)).toContain('v=0 offer');
    });

    test('with the writes grant the tools offer chat.send as well', async () => {
        const voice = sessions(true);
        void voice.start(client('client-1'), startPayload());
        await settle();
        expect(JSON.stringify(live.mints[0]!.body)).toContain('chat.send');
    });

    test('a start without a key fails before anything is minted', async () => {
        key = null;
        const owner = client('client-1');
        await expect(sessions().start(owner, startPayload())).rejects.toMatchObject({ code: 'voice-no-key' });
        expect(live.mints).toEqual([]);
        expect(phases(owner)).toEqual(['stopping', 'failed']);
        expect(holds).toEqual(['hold voice:session-1 project-1', 'letGo voice:session-1 project-1']);
    });

    test('an unknown project is refused before anything starts', async () => {
        await expect(sessions().start(client('client-1'), startPayload({ projectId: 'nowhere' }))).rejects.toMatchObject({ code: 'unknown-project' });
        expect(holds).toEqual([]);
    });

    test('the canvas on the phone is where actions land, and else the first canvas', async () => {
        const voice = sessions();
        void voice.start(client('client-1'), startPayload({ viewId: 'second' }));
        void voice.start(client('client-2'), startPayload({ viewId: 'gone' }));
        await settle();
        expect(live.mints).toHaveLength(2);
    });

    test('the deadline fails a start that hangs and aborts what it waited on', async () => {
        const owner = client('client-1');
        const answer = sessions().start(owner, startPayload());
        await settle();
        clock.advance(VOICE_START_DEADLINE_MS - 1);
        await settle();
        expect(phases(owner)).toEqual([]);
        clock.advance(1);
        await expect(answer).rejects.toMatchObject({ code: 'voice-start-timeout' });
        expect(live.mints[0]!.signal.aborted).toBe(true);
        expect(phases(owner)).toEqual(['stopping', 'failed']);
        expect(eventsOf(owner, 'voice.status').at(-1)!.payload.error).toMatchObject({ code: 'voice-start-timeout' });
        expect(holds.at(-1)).toBe('letGo voice:session-1 project-1');
    });

    test('a stop before the mint answers keeps the cancel, and a late mint is closed again', async () => {
        const voice = sessions();
        const owner = client('client-1');
        const answer = voice.start(owner, startPayload());
        await settle();
        expect(await voice.stop(owner, { sceneId: 'scene-1', startId: 'start-1' })).toEqual({ stopped: true });
        await expect(answer).rejects.toMatchObject({ code: 'voice-cancelled' });
        const minted = live.answerMint();
        await settle();
        expect(live.attaches).toEqual([]);
        expect(live.closed).toEqual([minted]);
        // A retry of the same start answers the same refusal and mints nothing new.
        await expect(voice.start(owner, startPayload())).rejects.toMatchObject({ code: 'voice-cancelled' });
        expect(live.mints).toHaveLength(1);
    });

    test('a stop during the attach closes the sideband and answers nothing', async () => {
        const voice = sessions();
        const owner = client('client-1');
        const answer = voice.start(owner, startPayload());
        await settle();
        live.answerMint();
        await settle();
        const stopping = voice.stop(owner, { sceneId: 'scene-1', startId: 'start-1' });
        await expect(answer).rejects.toMatchObject({ code: 'voice-cancelled' });
        await stopping;
        expect(live.attaches[0]!.signal.aborted).toBe(true);
        expect(phases(owner)).toEqual(['stopping', 'closed']);
    });

    test('a stop that overtook its start keeps the start from minting', async () => {
        const voice = sessions();
        const owner = client('client-1');
        expect(await voice.stop(owner, { sceneId: 'scene-1', startId: 'start-1' })).toEqual({ stopped: false });
        await expect(voice.start(owner, startPayload())).rejects.toMatchObject({ code: 'voice-cancelled' });
        expect(live.mints).toEqual([]);
    });

    test('the same start id answers the same start, and refuses one with other fields', async () => {
        const voice = sessions();
        const owner = client('client-1');
        const first = voice.start(owner, startPayload());
        const again = voice.start(owner, startPayload());
        expect(again).toBe(first);
        await expect(voice.start(owner, startPayload({ language: 'nl' }))).rejects.toMatchObject({ code: 'voice-start-conflict' });
        await settle();
        expect(live.mints).toHaveLength(1);
        // The same start id from another scene is another start.
        void voice.start(owner, startPayload({ sceneId: 'scene-2' }));
        await settle();
        expect(live.mints).toHaveLength(2);
    });

    test('a scene runs one session, and the machine a few', async () => {
        const voice = sessions();
        const owner = client('client-1');
        void voice.start(owner, startPayload());
        await expect(voice.start(owner, startPayload({ startId: 'start-2' }))).rejects.toMatchObject({ code: 'voice-busy' });
        for (let i = 1; i < MAX_VOICE_SESSIONS; i++) {
            void voice.start(client(`client-${i + 1}`), startPayload());
        }
        await expect(voice.start(client('client-99'), startPayload())).rejects.toMatchObject({ code: 'voice-busy' });
    });

    test('a mint that worked and an attach that did not closes the session at OpenAI', async () => {
        const owner = client('client-1');
        const answer = sessions().start(owner, startPayload());
        await settle();
        const minted = live.answerMint();
        await settle();
        live.failAttach();
        await expect(answer).rejects.toMatchObject({ code: 'voice-attach-failed' });
        expect(live.closed).toEqual([minted]);
        expect(phases(owner)).toEqual(['stopping', 'failed']);
    });

    test('a refused key fails the start with its code', async () => {
        const answer = sessions().start(client('client-1'), startPayload());
        await settle();
        live.failMint(new LiveError('voice-key-rejected', 'OpenAI rejected the Voice key on this machine'));
        await expect(answer).rejects.toMatchObject({ code: 'voice-key-rejected' });
        expect(live.closed).toEqual([]);
    });
});

describe('a running session', () => {
    test('runs a tool call through the registry once and sends its output on the sideband', async () => {
        threads.set('chat-1', [{ id: 'u1', kind: 'user', createdAt: 1, turnId: 't1', text: 'Build it' } as ChatItem]);
        const voice = sessions();
        const { attach, owner } = await started(voice);
        const call = functionCall('call-1', { action: 'chat.read', chatId: 'chat-1', limit: null });
        attach.socket.receive(call);
        attach.socket.receive(call);
        attach.socket.receive({ type: 'response.event', delegation_id: 'delegation-1', event: { type: 'response.completed' } });
        await settle();
        await settle();
        const outputs = attach.socket.sentOf('response.item.create');
        expect(outputs).toHaveLength(1);
        const output = JSON.parse(String((outputs[0]!.item as { output: string }).output));
        expect(output).toMatchObject({ ok: true, chat: 'Builder', messages: [{ role: 'user', text: 'Build it' }] });
        expect(attach.socket.sentOf('response.create')).toHaveLength(1);
        expect(eventsOf(owner, 'voice.activity').map((frame) => (frame.payload.entry as { status: string }).status)).toEqual(['running', 'completed']);
    });

    test('a call outside the policy is answered as refused and runs nothing', async () => {
        const voice = sessions(false);
        const { attach } = await started(voice);
        attach.socket.receive(functionCall('call-1', { action: 'chat.send', chatId: 'chat-1', prompt: 'hi', delivery: null, limit: null }));
        await settle();
        const output = JSON.parse(String((attach.socket.sentOf('response.item.create')[0]!.item as { output: string }).output));
        expect(output).toMatchObject({ ok: false, code: 'not-offered' });
    });

    test('a stop ends the session at OpenAI and lets go of the project', async () => {
        const voice = sessions();
        const { attach, owner, result } = await started(voice);
        const stopping = voice.stop(owner, { sceneId: 'scene-1', sessionId: result.sessionId });
        expect(attach.socket.sentOf('session.close')).toHaveLength(1);
        attach.socket.receive({ type: 'session.closed' });
        expect(await stopping).toEqual({ stopped: true });
        expect(attach.socket.closedWith).toBe(1000);
        expect(phases(owner)).toEqual(['active', 'stopping', 'closed']);
        expect(holds).toEqual(['hold voice:session-1 project-1', 'letGo voice:session-1 project-1']);
        expect(await voice.stop(owner, { sceneId: 'scene-1', sessionId: result.sessionId })).toEqual({ stopped: false });
    });

    test('a call that answers after the stop sends nothing more', async () => {
        let release!: () => void;
        threadGate = new Promise<void>((resolve) => {
            release = resolve;
        });
        threads.set('chat-1', []);
        const voice = sessions();
        const { attach, owner, result } = await started(voice);
        attach.socket.receive(functionCall('call-1', { action: 'chat.read', chatId: 'chat-1', limit: null }));
        await settle();
        const stopping = voice.stop(owner, { sceneId: 'scene-1', sessionId: result.sessionId });
        attach.socket.receive({ type: 'session.closed' });
        await stopping;
        release();
        await settle();
        await settle();
        expect(attach.socket.sentOf('response.item.create')).toEqual([]);
    });

    test('another connection or scene cannot stop it, confirm in it or hear it', async () => {
        const voice = sessions();
        const { owner, result } = await started(voice);
        const other = client('client-2');
        await expect(voice.stop(other, { sceneId: 'scene-1', sessionId: result.sessionId })).rejects.toMatchObject({ code: 'forbidden' });
        await expect(voice.stop(owner, { sceneId: 'scene-2', sessionId: result.sessionId })).rejects.toMatchObject({ code: 'forbidden' });
        await expect(voice.confirm(other, { sceneId: 'scene-1', sessionId: result.sessionId, token: 't', decision: 'confirm' })).rejects.toMatchObject({
            code: 'forbidden'
        });
        expect(await voice.confirm(owner, { sceneId: 'scene-1', sessionId: result.sessionId, token: 'unknown', decision: 'confirm' })).toEqual({
            accepted: false
        });
        expect(other.frames).toEqual([]);
        expect(phases(owner)).toEqual(['active']);
    });

    test('a link that goes ends its sessions and leaves the others', async () => {
        const voice = sessions();
        const first = await started(voice);
        const second = await started(voice, client('client-2'));
        first.owner.closed = true;
        voice.channelClosed('client-1');
        expect(first.attach.socket.sentOf('session.close')).toHaveLength(1);
        first.attach.socket.receive({ type: 'session.closed' });
        await settle();
        expect(second.attach.socket.sentOf('session.close')).toEqual([]);
        expect(voice.size).toBe(1);
        // The owner is gone, so it hears nothing of the end.
        expect(phases(first.owner)).toEqual(['active']);
    });

    test('a sideband that drops fails the session', async () => {
        const voice = sessions();
        const { attach, owner } = await started(voice);
        attach.socket.drop(1011);
        await settle();
        expect(phases(owner)).toEqual(['active', 'stopping', 'failed']);
        expect(eventsOf(owner, 'voice.status').at(-1)!.payload.error).toMatchObject({ code: 'voice-sideband-lost' });
        expect(voice.size).toBe(0);
    });

    test('a client event the daemon never sent ends the session', async () => {
        const voice = sessions();
        const { attach, owner } = await started(voice);
        attach.socket.receive({ type: 'response.create', event_id: 'from-the-phone' });
        await settle();
        expect(eventsOf(owner, 'voice.status').at(-1)!.payload).toMatchObject({ phase: 'stopping', error: { code: 'voice-foreign-client' } });
        attach.socket.receive({ type: 'session.closed' });
        await settle();
        expect(phases(owner).at(-1)).toBe('failed');
    });

    test('a session OpenAI closed is closed here too', async () => {
        const voice = sessions();
        const { attach, owner } = await started(voice);
        attach.socket.receive({ type: 'session.closed' });
        await settle();
        expect(phases(owner)).toEqual(['active', 'stopping', 'closed']);
    });

    test('shutting down ends every session at OpenAI', async () => {
        const voice = sessions();
        const first = await started(voice);
        const second = await started(voice, client('client-2'));
        const stopping = voice.stopAll();
        first.attach.socket.receive({ type: 'session.closed' });
        second.attach.socket.receive({ type: 'session.closed' });
        await stopping;
        expect(voice.size).toBe(0);
    });
});
