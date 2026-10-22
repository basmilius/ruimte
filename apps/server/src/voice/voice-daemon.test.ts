import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ChatTurnItem, ProjectContent, ServerFrame, VoiceStartPayload } from '@ruimte/contracts';
import { ACTION_DEFINITIONS } from '@ruimte/actions';
import type { LiveEvent } from '@ruimte/voice';
import { ManualClock } from '@adecore/agents/testing';
import { serverActions } from '../actions/server-actions.ts';
import { voiceActionCall } from '../actions/context.ts';
import type { ClientConnection } from '../dispatcher.ts';
import { projectLinks } from '../projects/project-file-test-helpers.ts';
import { ProjectStore } from '../projects/project-store.ts';
import { bootTestDaemon, type TestDaemon } from '../tasks/test-daemon.ts';
import { FakeClock, FakeLive, settle, type FakeAttach } from './voice-fakes.ts';
import { VoiceSessions } from './voice-sessions.ts';

/*
 * Voice run by the daemon against the test daemon: the real registry, outbox, lineage and chat manager
 * with fake CLIs, and GPT-Live faked behind its interface. No wall clock: the outbox and the chats run on
 * what the test awaits, and Voice's own timers on a clock the test moves.
 */

function content(name: string, withCanvas: boolean): ProjectContent {
    return {
        name,
        color: '#123456',
        views: withCanvas
            ? [
                  {
                      kind: 'canvas',
                      id: 'main',
                      name: 'Canvas',
                      nodes: [{ id: 'chat-lead', kind: 'chat', title: 'Lead', x: 0, y: 0, w: 560, h: 640, provider: 'claude' }],
                      texts: [],
                      edges: [],
                      layouts: []
                  }
              ]
            : [{ kind: 'chat', id: 'chat-notes', name: 'Notes', node: {} }]
    };
}

let root: string;
let home: string;
let folder: string;
let bare: string;
let store: ProjectStore;
let projectId: string;
let bareId: string;
let daemon: TestDaemon;
let voiceClock: FakeClock;
let live: FakeLive;

beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'ruimte-voice-daemon-'));
    home = join(root, 'home');
    folder = join(root, 'shop');
    bare = join(root, 'bare');
    await mkdir(folder, { recursive: true });
    await mkdir(bare, { recursive: true });
    store = new ProjectStore(home, projectLinks());
    for (const [path, name, withCanvas] of [
        [folder, 'Shop', true],
        [bare, 'Bare', false]
    ] as const) {
        const opened = await store.openProject({ folder: path });
        await store.save(opened.summary.projectId, opened.document.rev, content(name, withCanvas));
        store.release(opened.summary.projectId);
        if (withCanvas) {
            projectId = opened.summary.projectId;
        } else {
            bareId = opened.summary.projectId;
        }
    }
    daemon = await bootTestDaemon({ home, store, clock: new ManualClock(), installed: ['claude', 'codex'] });
    daemon.worker.start();
    voiceClock = new FakeClock();
    live = new FakeLive(voiceClock);
});

afterEach(async () => {
    await daemon.stop();
    store.closeAll();
    await rm(root, { recursive: true, force: true });
});

function voiceSessions(): VoiceSessions {
    let ids = 0;
    return new VoiceSessions({
        live,
        key: async () => 'sk-test-voice-0123456789abcdef',
        preferences: () => null,
        clock: voiceClock,
        holds: {
            hold: (holder, held) => store.hold(holder, held, { startsLaunches: false }),
            letGo: (holder, held) => store.letGo(holder, held)
        },
        runner: serverActions,
        host: daemon.host,
        chats: {
            observe: (sink) => daemon.chats.observe(sink),
            thread: (chatId) => {
                const chat = daemon.chats.get(chatId);
                return chat === undefined ? null : { items: chat.thread.list(), info: chat.info };
            }
        },
        index: store.index,
        projects: store,
        machine: { id: 'machine-1', label: 'Studio' },
        newId: () => `session-${++ids}`
    });
}

const phone: ClientConnection & { frames: ServerFrame[] } = { id: 'phone', frames: [], send: (frame) => phone.frames.push(frame) };

async function started(voice: VoiceSessions, project = projectId): Promise<FakeAttach> {
    const payload: VoiceStartPayload = {
        startId: `start-${project}`,
        sceneId: 'scene-1',
        projectId: project,
        sdp: 'v=0 offer',
        language: 'en',
        voice: 'marin',
        timeZone: 'Europe/Amsterdam'
    };
    const minted = live.mints.length;
    const answer = voice.start(phone, payload);
    await live.minting(minted + 1);
    live.answerMint();
    await settle();
    const attach = live.answerAttach();
    await answer;
    return attach;
}

function call(attach: FakeAttach, callId: string, tool: string, args: Record<string, unknown>): void {
    attach.socket.receive({
        type: 'response.event',
        delegation_id: 'delegation-1',
        event: { type: 'response.output_item.done', item: { type: 'function_call', call_id: callId, name: tool, arguments: JSON.stringify(args) } }
    });
}

/* Resolves once the daemon sent what `check` looks for on this sideband, looked at again on every frame it sends. */
function sentOn(attach: FakeAttach, check: () => boolean): Promise<void> {
    const socket = attach.socket as FakeAttach['socket'] & { waiting?: (() => void)[] };
    if (socket.waiting === undefined) {
        const waiting: (() => void)[] = [];
        socket.waiting = waiting;
        const send = socket.send.bind(socket);
        socket.send = (data: string) => {
            send(data);
            for (const wake of waiting.splice(0)) {
                wake();
            }
        };
    }
    const look = (resolve: () => void): void => {
        if (check()) {
            resolve();
        } else {
            socket.waiting!.push(() => look(resolve));
        }
    };
    return new Promise(look);
}

/* The output the daemon sent for a call, once it did. */
async function outputOf(attach: FakeAttach, callId: string): Promise<Record<string, unknown>> {
    const find = () => attach.socket.sentOf('response.item.create').find((event) => (event.item as { call_id?: string }).call_id === callId);
    await sentOn(attach, () => find() !== undefined);
    return JSON.parse(String((find()!.item as { output: string }).output)) as Record<string, unknown>;
}

/* Acks every append as GPT-Live does, until the queue has nothing more to send; what came out, in order. */
function heard(attach: FakeAttach): string[] {
    const acked = new Set<string>();
    for (;;) {
        const waiting = attach.socket.sent.filter(
            (event) => (event.type === 'session.thinking.append' || event.type === 'session.commentary.append') && !acked.has(String(event.event_id))
        );
        if (waiting.length === 0) {
            break;
        }
        for (const event of waiting) {
            acked.add(String(event.event_id));
            attach.socket.receive({ type: `${event.type}ed`, client_event_id: event.event_id } as LiveEvent);
        }
    }
    return attach.socket.sent
        .filter((event) => event.type === 'session.thinking.append' || event.type === 'session.commentary.append')
        .map((event) => String(event.content));
}

/* A report the follower sent: its context put back together, up to the commentary that makes the model speak. */
function reports(attach: FakeAttach): string {
    return heard(attach).join('');
}

const START = {
    provider: 'claude',
    terminal: false,
    prompt: 'hello',
    viewId: null,
    beside: null,
    title: 'Helper',
    model: null,
    mode: null,
    requestId: 'mine',
    effort: null
};

function turnsOf(chatId: string): ChatTurnItem[] {
    return (daemon.chats.get(chatId)?.thread.list() ?? []).filter((item): item is ChatTurnItem => item.kind === 'turn');
}

describe('Voice starts a chat on the daemon', () => {
    test('a supervised chat at depth 1, with a claim of its own, followed to the end of its first turn', async () => {
        const voice = voiceSessions();
        const attach = await started(voice);
        call(attach, 'call-1', 'inspect_agents', { action: 'agent.start', ...START });
        const output = await outputOf(attach, 'call-1');
        expect(output).toMatchObject({ ok: true, status: 'running', kind: 'chat', viewId: 'main', edge: null });
        const chatId = String(output.nodeId);

        await daemon.worker.settled();
        await daemon.until(() => turnsOf(chatId)[0]?.state === 'done');
        expect([daemon.lineage.depthOf(chatId), daemon.lineage.ceilingOf(chatId), daemon.lineage.startedBy(chatId)]).toEqual([
            1,
            'supervised',
            'voice:session-1'
        ]);
        expect(daemon.enqueued.find((work) => work.kind === 'start-agent')).toMatchObject({
            payload: { node: 'chat', provider: 'claude', ceiling: 'supervised' }
        });
        expect(daemon.chats.get(chatId)?.info.runtimeMode).toBe('supervised');

        const said = reports(attach);
        expect(said).toContain('AI Chat “Helper”, which you prompted, finished. Project: Shop.');
        expect(said).toContain(`Its tracked turn ${turnsOf(chatId)[0]!.id} ended with state done`);
        expect(said).toContain('echo: hello');
        expect(attach.socket.sentOf('session.commentary.append').length).toBeGreaterThan(0);

        // The phone's timeline names the steps, and never what the chat said or the arguments of the call.
        const timeline = phone.frames
            .filter((frame): frame is Extract<ServerFrame, { type: 'event' }> => 'type' in frame && frame.type === 'event' && frame.event === 'voice.activity')
            .map((frame) => (frame.payload as { entry: { label: string; detail: string } }).entry);
        expect(timeline.map((entry) => entry.label)).toEqual(
            expect.arrayContaining(['Started “Helper”', '“Helper” is running', '“Helper” took its first prompt', '“Helper” finished'])
        );
        expect(JSON.stringify(timeline)).not.toContain('echo: hello');
        expect(timeline.every((entry) => entry.detail === '')).toBe(true);
    });

    test('the request id is the session and call id, so a repeated start makes no second chat', async () => {
        const voice = voiceSessions();
        const attach = await started(voice);
        call(attach, 'call-1', 'inspect_agents', { action: 'agent.start', ...START });
        const first = await outputOf(attach, 'call-1');
        await daemon.worker.settled();

        // The same start once more, under the id the executor gave it, answers with the node the first made.
        const place = { projectId, folder, canvasId: 'main' };
        const caller = { sessionId: 'session-1', owner: { clientId: 'phone', sceneId: 'scene-1' }, projectId, timeZone: 'UTC' };
        // Every field the action has, the way the executor hands them on.
        const full = { ...Object.fromEntries(Object.keys(ACTION_DEFINITIONS['agent.start'].input.shape).map((field) => [field, null])), ...START };
        const again = await serverActions.execute('agent.start', { ...full, requestId: 'voice:session-1:call-1' }, voiceActionCall(daemon.host, place, caller));
        expect(again).toMatchObject({ output: { nodeId: first.nodeId } });
        // What the model named as its id never counts: it was replaced, so this is another start.
        const other = await serverActions.execute('agent.start', full, voiceActionCall(daemon.host, place, caller));
        expect(other).toMatchObject({ status: 'running' });
        expect(other).not.toMatchObject({ output: { nodeId: first.nodeId } });
        expect(daemon.enqueued.filter((work) => work.kind === 'start-agent')).toHaveLength(2);
    });

    test('a start that made its chat answers with it, even when the name of the project cannot be read after', async () => {
        const place = { projectId, folder, canvasId: 'main' };
        const bound: string[] = [];
        let dropped = 0;
        const caller = {
            sessionId: 'session-1',
            owner: { clientId: 'phone', sceneId: 'scene-1' },
            projectId,
            timeZone: 'UTC',
            follow: {
                expectPrompt: () => ({ bind: () => undefined, drop: () => undefined }),
                expectStart: () => ({ bind: (chatId: string, chat: { project: string }) => bound.push(`${chatId} in ${chat.project}`), drop: () => dropped++ }),
                cleared: () => undefined
            }
        };
        const projects = daemon.host.projects;
        let made = false;
        const failing = new Proxy(projects, {
            get: (target, property) => {
                if (property === 'read' && made) {
                    return async () => {
                        throw new Error('the project file went');
                    };
                }
                if (property === 'mutate') {
                    return async (...args: Parameters<typeof projects.mutate>) => {
                        const result = await projects.mutate(...args);
                        made = true;
                        return result;
                    };
                }
                const value: unknown = Reflect.get(target, property);
                return typeof value === 'function' ? value.bind(target) : value;
            }
        });
        const full = { ...Object.fromEntries(Object.keys(ACTION_DEFINITIONS['agent.start'].input.shape).map((field) => [field, null])), ...START };
        const result = await serverActions.execute(
            'agent.start',
            { ...full, requestId: 'voice:session-1:call-1' },
            voiceActionCall({ ...daemon.host, projects: failing }, place, caller)
        );
        expect(result).toMatchObject({ status: 'running', output: { kind: 'chat' } });
        const nodeId = (result as { output: { nodeId: string } }).output.nodeId;
        // Followed under the id of the project, since its name could not be read; never dropped as a start that failed.
        expect(bound).toEqual([`${nodeId} in ${projectId}`]);
        expect(dropped).toBe(0);
    });

    test('a folder made from the work of another machine starts no CLI that would load its configuration', async () => {
        await store.peers.untrustFolder(folder);
        const voice = voiceSessions();
        const attach = await started(voice);
        call(attach, 'call-1', 'inspect_agents', { action: 'agent.start', ...START, provider: 'codex' });
        expect(await outputOf(attach, 'call-1')).toMatchObject({ ok: false, code: 'untrusted-folder' });
        expect(daemon.enqueued.filter((work) => work.kind === 'start-agent')).toEqual([]);
    });

    test('a project without a canvas gets a chat view of its own, which runs and is reported', async () => {
        const voice = voiceSessions();
        const attach = await started(voice, bareId);
        call(attach, 'call-1', 'inspect_agents', { action: 'agent.start', ...START, title: 'Notes too' });
        const output = await outputOf(attach, 'call-1');
        expect(output).toMatchObject({ ok: true, kind: 'chat', viewId: null });
        const chatId = String(output.nodeId);
        expect((await store.read(bareId)).views.find((view) => view.id === chatId)).toMatchObject({ kind: 'chat', name: 'Notes too' });
        await daemon.worker.settled();
        await daemon.until(() => turnsOf(chatId)[0]?.state === 'done');
        expect(reports(attach)).toContain('AI Chat “Notes too”, which you prompted, finished. Project: Bare.');
    });

    test('after a switch a chat starts in the project Voice moved to, which the session holds instead', async () => {
        const voice = voiceSessions();
        const attach = await started(voice, bareId);
        const voiceHolder = (projectIdOf: string) => store.holdersOf(projectIdOf).filter((holder) => holder.startsWith('voice:'));
        expect([voiceHolder(bareId), voiceHolder(projectId)]).toEqual([['voice:session-1'], []]);
        call(attach, 'call-1', 'manage_projects', { action: 'project.switch', endpointId: 'machine-1', projectId });
        expect(await outputOf(attach, 'call-1')).toMatchObject({ ok: true, project: 'Shop', projectId });
        expect([voiceHolder(bareId), voiceHolder(projectId)]).toEqual([[], ['voice:session-1']]);
        call(attach, 'call-2', 'inspect_agents', { action: 'agent.start', ...START });
        const output = await outputOf(attach, 'call-2');
        expect(output).toMatchObject({ ok: true, kind: 'chat', viewId: 'main' });
        expect(store.index.locate(String(output.nodeId))?.projectId).toBe(projectId);
        await daemon.worker.settled();
        await daemon.until(() => turnsOf(String(output.nodeId))[0]?.state === 'done');
        expect(reports(attach)).toContain('AI Chat “Helper”, which you prompted, finished. Project: Shop.');
    });

    test('four chats at once are each reported by their own first turn', async () => {
        const voice = voiceSessions();
        const attach = await started(voice);
        for (let i = 1; i <= 4; i++) {
            call(attach, `call-${i}`, 'inspect_agents', { action: 'agent.start', ...START, title: `Helper ${i}`, prompt: `job ${i}` });
        }
        const ids = await Promise.all([1, 2, 3, 4].map(async (i) => String((await outputOf(attach, `call-${i}`)).nodeId)));
        expect(new Set(ids).size).toBe(4);
        await daemon.worker.settled();
        await daemon.until(() => ids.every((id) => turnsOf(id)[0]?.state === 'done'));
        const said = reports(attach);
        for (let i = 1; i <= 4; i++) {
            expect(said).toContain(`AI Chat “Helper ${i}”, which you prompted, finished.`);
            expect(said).toContain(`echo: job ${i}`);
        }
    });
});

describe('Voice prompts a chat on the daemon', () => {
    test('a queued prompt is reported at the end of its own turn, not of the turn it waited behind', async () => {
        await daemon.chats.create({ chatId: 'chat-lead', provider: 'claude', cwd: folder });
        // A turn that waits on the person's answer, so the prompt Voice sends has to queue behind it.
        await daemon.chats.send('chat-lead', 'ask: Which color?');
        await daemon.until(() => daemon.chats.get('chat-lead')?.info.status === 'needs-you');
        const first = daemon.chats.get('chat-lead')!.info.activeTurnId!;

        const voice = voiceSessions();
        const attach = await started(voice);
        call(attach, 'call-1', 'communicate', { action: 'chat.send', chatId: 'chat-lead', prompt: 'next', delivery: 'queue' });
        const output = await outputOf(attach, 'call-1');
        expect(output).toMatchObject({ ok: true, chat: 'Lead', queued: true });
        const own = String(output.turnId);
        expect(own).not.toBe(first);
        // The wait is the turn before, which Voice did not set going.
        expect(reports(attach)).not.toContain('now waits for the user');

        daemon.chats.answer('chat-lead', 'req-q', { 'Which color?': 'Red' });
        await daemon.until(() => turnsOf('chat-lead').find((turn) => turn.id === first)?.state === 'done');
        expect(reports(attach)).not.toContain('which you prompted, finished');

        await daemon.until(() => turnsOf('chat-lead').find((turn) => turn.id === own)?.state === 'done');
        const said = reports(attach);
        expect(said).toContain(`AI Chat “Lead”, which you prompted, finished. Project: Shop. Its tracked turn ${own} ended with state done`);
        expect(said).toContain('echo: next');
        expect(said).not.toContain('you chose Red');
    });
});
