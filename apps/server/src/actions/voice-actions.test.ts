import { beforeEach, describe, expect, test } from 'bun:test';
import type { AgentInfo, ChatInfo, ChatItem, ProjectContent } from '@ruimte/contracts';
import type { CanvasHost } from '../canvas/verb.ts';
import type { IndexedPlace } from '../projects/project-index.ts';
import type { VoiceFollowHost } from '../voice/voice-follower.ts';
import { serverActionCall, voiceActionCall, type VoiceCaller } from './context.ts';
import { serverActions } from './server-actions.ts';
import type { ActionOutput } from '@ruimte/actions';

const PLACE: IndexedPlace = { projectId: 'project-1', folder: '/work/app', canvasId: 'main' };
const VOICE: VoiceCaller = {
    sessionId: 'session-1',
    owner: { clientId: 'client-1', sceneId: 'scene-1' },
    projectId: 'project-1',
    timeZone: 'Europe/Amsterdam'
};

const CONTENT = {
    name: 'Shop',
    views: [
        {
            id: 'main',
            kind: 'canvas',
            name: 'Main',
            nodes: [
                { id: 'chat-node', kind: 'chat', title: 'Builder', x: 0, y: 0, w: 400, h: 300 },
                { id: 'term-node', kind: 'terminal', title: 'Shell', x: 0, y: 0, w: 400, h: 300 },
                { id: 'agent-term', kind: 'terminal', title: 'Codex', x: 0, y: 0, w: 400, h: 300 },
                { id: 'note-1', kind: 'note', title: 'Plan', x: 0, y: 0, w: 400, h: 300 }
            ],
            edges: []
        },
        { id: 'chat-view', kind: 'chat', name: 'Planning' },
        {
            id: 'peer-b',
            kind: 'canvas',
            name: 'Machine B',
            hidden: true,
            nodes: [{ id: 'peer-chat', kind: 'chat', title: 'Builder', x: 0, y: 0, w: 1, h: 1 }],
            edges: []
        },
        { id: 'inline-edit', kind: 'chat', name: 'Planning', hidden: true }
    ]
} as unknown as ProjectContent;

let loaded: Map<string, ChatItem[]>;
let stored: Map<string, ChatItem[]>;
let bound: Set<string>;
let places: Map<string, string>;
let reads: string[];
let infos: Map<string, ChatInfo>;
let terminals: Map<string, AgentInfo | null>;
let running: Set<string>;
let sent: { chatId: string; text: string; delivery: string | undefined }[];
let sendFails: boolean;
let cleared: string[];
let followed: string[];

function item(id: string, kind: 'user' | 'assistant', text: string, extra: Record<string, unknown> = {}): ChatItem {
    return {
        id,
        kind,
        createdAt: Number(id.replace(/\D/g, '')) || 1,
        turnId: 't1',
        text,
        ...(kind === 'assistant' ? { streaming: false } : {}),
        ...extra
    } as ChatItem;
}

function host(): CanvasHost {
    return {
        projects: {
            locate: (id: string) => (places.has(id) ? { ...PLACE, projectId: places.get(id)! } : null),
            machineOfNode: (id: string) => (bound.has(id) ? 'machine-b' : null),
            read: async (projectId: string) => {
                reads.push(projectId);
                return CONTENT;
            },
            revision: async () => 7
        } as Partial<CanvasHost['projects']> as CanvasHost['projects'],
        chatThreads: { items: async (chatId) => loaded.get(chatId) ?? stored.get(chatId) ?? null, info: async (chatId) => infos.get(chatId) ?? null },
        terminals: { agentOf: (sessionId) => terminals.get(sessionId) },
        chatPrompts: {
            running: (chatId) => running.has(chatId),
            send: async (chatId, text, delivery) => {
                if (sendFails) {
                    throw new Error('the CLI went');
                }
                sent.push({ chatId, text, delivery });
                return { queued: delivery === 'queue', turnId: 'turn-9' };
            },
            clear: async (chatId) => {
                cleared.push(chatId);
            }
        }
    } as Partial<CanvasHost> as CanvasHost;
}

function readAs(chatId: string, limit: number | null = null) {
    return serverActions.execute('chat.read', { chatId, limit }, voiceActionCall(host(), PLACE, VOICE));
}

beforeEach(() => {
    loaded = new Map();
    stored = new Map();
    bound = new Set();
    places = new Map([
        ['chat-node', 'project-1'],
        ['term-node', 'project-1'],
        ['chat-view', 'project-1'],
        ['elsewhere', 'project-2']
    ]);
    reads = [];
    infos = new Map();
    terminals = new Map();
    running = new Set();
    sent = [];
    sendFails = false;
    cleared = [];
    followed = [];
});

const FOLLOW: VoiceFollowHost = {
    expectPrompt: (chatId, chat) => {
        followed.push(`expect ${chatId} ${chat.chat} in ${chat.project}`);
        return { bind: (turnId) => followed.push(`bind ${turnId}`), drop: () => followed.push('drop') };
    },
    expectStart: () => ({ bind: () => undefined, drop: () => undefined }),
    cleared: (chatId) => followed.push(`cleared ${chatId}`)
};

function info(chatId: string, fields: Partial<ChatInfo> = {}): ChatInfo {
    return {
        chatId,
        provider: 'claude',
        selection: { model: 'claude-sonnet', options: {} },
        runtimeMode: 'supervised',
        status: 'idle',
        activeTurnId: null,
        ...fields
    } as ChatInfo;
}

function terminalAgent(status: AgentInfo['status'], live = true): AgentInfo {
    return { kind: 'codex', agentSessionId: 'x', transcriptPath: null, status, live, updatedAt: 42 };
}

function asVoice<Name extends Parameters<typeof serverActions.execute>[0]>(name: Name, input: unknown, place = PLACE) {
    return serverActions.execute(name, input, voiceActionCall(host(), place, VOICE));
}

describe('chat.read for Voice', () => {
    test('reads what was said in a running chat, without reasoning, tools or what a sub-agent said', async () => {
        loaded.set('chat-node', [
            item('u1', 'user', 'Build the login page'),
            { id: 'th2', kind: 'thinking', createdAt: 2, turnId: 't1', text: 'Hm', streaming: false, endedAt: 3 } as ChatItem,
            {
                id: 'tool3',
                kind: 'tool',
                createdAt: 3,
                turnId: 't1',
                toolUseId: 'x',
                name: 'Bash',
                input: {},
                output: 'secret output',
                state: 'done',
                parentToolUseId: null
            } as ChatItem,
            item('a4', 'assistant', 'Inside the sub-agent', { parentToolUseId: 'x' }),
            item('a5', 'assistant', '  The page is built.  ', { parentToolUseId: null }),
            item('u6', 'user', '   ')
        ]);
        const result = await readAs('chat-node');
        expect(result).toMatchObject({
            status: 'completed',
            output: {
                chatId: 'chat-node',
                chat: 'Builder',
                messages: [
                    { role: 'user', text: 'Build the login page', createdAt: 1 },
                    { role: 'assistant', text: 'The page is built.', createdAt: 5 }
                ],
                truncated: false
            }
        });
        expect(JSON.stringify(result)).not.toContain('secret output');
    });

    test('reads a chat view whose CLI does not run from its record, and honors the limit', async () => {
        stored.set('chat-view', [item('u1', 'user', 'one'), item('a2', 'assistant', 'two'), item('u3', 'user', 'three')]);
        expect(await readAs('chat-view', 2)).toMatchObject({
            status: 'completed',
            output: { chat: 'Planning', messages: [{ text: 'two' }, { text: 'three' }], truncated: true }
        });
    });

    test('a long thread keeps its newest messages within the bound', async () => {
        loaded.set('chat-node', [item('u1', 'user', 'old'), item('a2', 'assistant', 'x'.repeat(5000)), item('u3', 'user', 'y'.repeat(5000))]);
        const result = await readAs('chat-node');
        const messages = (result as { output: { messages: { text: string }[]; truncated: boolean } }).output;
        expect(messages.messages.map((message) => message.text.length)).toEqual([3, 3000, 3000]);
        expect(messages.truncated).toBe(true);
    });

    test('a chat node nobody opened yet reads as empty', async () => {
        expect(await readAs('chat-node')).toMatchObject({ status: 'completed', output: { messages: [], truncated: false } });
    });

    test('refuses a chat on another machine before reading anything', async () => {
        bound.add('chat-node');
        loaded.set('chat-node', [item('u1', 'user', 'hello')]);
        expect(await readAs('chat-node')).toMatchObject({ status: 'failed', error: { code: 'remote-target' } });
        expect(reads).toEqual([]);
    });

    test('refuses what is no chat of the session project', async () => {
        loaded.set('elsewhere', [item('u1', 'user', 'other project')]);
        expect(await readAs('elsewhere')).toMatchObject({ status: 'failed', error: { code: 'not-in-project' } });
        expect(await readAs('term-node')).toMatchObject({ status: 'failed', error: { code: 'not-in-project' } });
        expect(await readAs('nowhere')).toMatchObject({ status: 'failed', error: { code: 'not-in-project' } });
    });

    test('an agent never reads a chat through this handler', async () => {
        loaded.set('chat-node', [item('u1', 'user', 'hello')]);
        expect(await serverActions.execute('chat.read', { chatId: 'chat-node', limit: null }, serverActionCall(host(), PLACE, 'term-node'))).toMatchObject({
            status: 'failed',
            error: { code: 'forbidden-action' }
        });
    });
});

describe('workspace.inspect for Voice', () => {
    test('reads the views and the canvas actions land on, with what each agent does, and names what a phone cannot know', async () => {
        infos.set('chat-node', info('chat-node', { status: 'running', activeTurnId: 'turn-1' }));
        terminals.set('term-node', null);
        terminals.set('agent-term', terminalAgent('needs-you'));
        const result = await asVoice('workspace.inspect', {});
        expect(result).toMatchObject({
            status: 'completed',
            output: {
                project: 'Shop',
                revision: 7,
                activeView: { id: 'main', name: 'Main', kind: 'canvas' },
                views: [
                    { id: 'main', name: 'Main', kind: 'canvas' },
                    { id: 'chat-view', name: 'Planning', kind: 'chat' }
                ],
                cells: [],
                canvas: {
                    viewId: 'main',
                    nodes: [
                        { id: 'chat-node', title: 'Builder', kind: 'chat', visible: false, status: 'running' },
                        { id: 'term-node', title: 'Shell', kind: 'terminal', visible: false },
                        { id: 'agent-term', title: 'Codex', kind: 'terminal', visible: false, status: 'needs-you' },
                        { id: 'note-1', title: 'Plan', kind: 'note', visible: false }
                    ],
                    selected: []
                },
                unknown: ['cells', 'selection', 'visible']
            }
        });
        // A plain shell is no agent, so it has no status at all rather than an unknown one.
        const nodes = (result as { output: ActionOutput<'workspace.inspect'> }).output.canvas!.nodes;
        expect(nodes.find((node) => node.id === 'term-node')).not.toHaveProperty('status');
    });

    test('a project without a canvas answers with its views and no canvas', async () => {
        expect(await asVoice('workspace.inspect', {}, { ...PLACE, canvasId: null })).toMatchObject({
            status: 'completed',
            output: { activeView: null, canvas: null }
        });
    });
});

describe('target.resolve for Voice', () => {
    function resolve(target: string, names: string[] | null, fields: Record<string, unknown> = {}) {
        return asVoice('target.resolve', { target, names, nodeKind: null, scope: null, machine: null, ...fields });
    }

    test('finds views, nodes of the canvas, chats and agents of the whole project by name, and never a hidden one', async () => {
        expect(await resolve('view', ['planning'])).toMatchObject({ output: { found: [{ id: 'chat-view', kind: 'chat' }], ambiguous: [], missing: [] } });
        expect(await resolve('node', ['plan'])).toMatchObject({ output: { found: [{ id: 'note-1', viewId: 'main' }] } });
        expect(await resolve('node', ['shell'], { nodeKind: 'chat' })).toMatchObject({ output: { found: [], missing: ['shell'] } });
        expect(await resolve('chat', ['Builder', 'Planning'])).toMatchObject({
            output: {
                found: [
                    { id: 'chat-node', kind: 'chat' },
                    { id: 'chat-view', kind: 'chat' }
                ],
                ambiguous: [],
                missing: []
            }
        });
        expect(await resolve('agent', ['codex'])).toMatchObject({ output: { found: [{ id: 'agent-term', kind: 'terminal' }] } });
        expect(await resolve('agent', ['Builder (Main)'])).toMatchObject({ output: { found: [{ id: 'chat-node' }] } });
    });

    test('a name that fits more than one comes back with every candidate', async () => {
        expect(await resolve('agent', ['e'])).toMatchObject({ output: { found: [], ambiguous: [{ name: 'e', candidates: expect.any(Array) }] } });
    });

    test('without names only the canvas and the project of the session resolve; the rest is named', async () => {
        expect(await resolve('view', null)).toMatchObject({ output: { found: [{ id: 'main' }] } });
        expect(await resolve('project', null)).toMatchObject({ output: { found: [{ id: 'project-1', name: 'Shop', kind: 'project' }] } });
        expect(await resolve('project', ['shop'])).toMatchObject({ output: { found: [{ id: 'project-1' }] } });
        expect(await resolve('project', ['other'])).toMatchObject({ output: { found: [], missing: ['other'] } });
        for (const target of ['node', 'chat', 'agent']) {
            expect(await resolve(target, null)).toMatchObject({ status: 'failed', error: { code: 'needs-window' } });
        }
        expect(await resolve('node', ['plan'], { scope: 'visible' })).toMatchObject({ status: 'failed', error: { code: 'needs-window' } });
        expect(await resolve('node', ['plan'], { scope: 'selected' })).toMatchObject({ status: 'failed', error: { code: 'needs-window' } });
    });
});

describe('chat.inspect for Voice', () => {
    test('reads what a chat runs on and waits on, an approval and a background task by description only', async () => {
        infos.set(
            'chat-node',
            info('chat-node', {
                status: 'needs-you',
                activeTurnId: 'turn-2',
                queue: [{ id: 'q1', turnId: 'turn-3', text: 'Then deploy', createdAt: 1 }],
                background: [{ id: 'bg-1', kind: 'shell', description: 'Dev server', command: 'API_TOKEN=sk-background-secret bun dev', startedAt: 1 }]
            })
        );
        loaded.set('chat-node', [
            { id: 'turn-1', kind: 'turn', createdAt: 1, turnId: 'turn-1', state: 'done', endedAt: 2, costUsd: 0 } as ChatItem,
            {
                id: 'approval-r1',
                kind: 'approval',
                createdAt: 3,
                turnId: 'turn-2',
                requestId: 'r1',
                toolUseId: null,
                toolName: 'Bash',
                input: { command: 'deploy --token sk-secret-value' },
                description: 'Deploy the shop',
                canAllowAlways: false,
                decision: 'pending'
            } as ChatItem
        ]);
        const result = await asVoice('chat.inspect', { chatId: 'chat-node' });
        expect(result).toMatchObject({
            status: 'completed',
            output: {
                chat: 'Builder',
                provider: 'claude',
                status: 'needs-you',
                working: true,
                open: true,
                queue: [{ messageId: 'q1', text: 'Then deploy' }],
                approvals: [{ requestId: 'r1', tool: 'Bash', description: 'Deploy the shop' }],
                tasks: [{ taskId: 'bg-1', kind: 'shell', description: 'Dev server', command: null }],
                lastTurnId: 'turn-1'
            }
        });
        expect(JSON.stringify(result)).not.toContain('sk-secret-value');
        expect(JSON.stringify(result)).not.toContain('sk-background-secret');
    });

    test('a chat that never started has nothing to inspect, and one of another project is refused', async () => {
        expect(await asVoice('chat.inspect', { chatId: 'chat-node' })).toMatchObject({ status: 'failed', error: { code: 'chat-not-started' } });
        expect(await asVoice('chat.inspect', { chatId: 'elsewhere' })).toMatchObject({ status: 'failed', error: { code: 'not-in-project' } });
        expect(await asVoice('chat.inspect', { chatId: 'inline-edit' })).toMatchObject({ status: 'failed', error: { code: 'not-in-project' } });
    });
});

describe('agents.inspect for Voice', () => {
    test('reads every chat and terminal agent of the project, without plain shells or what runs on another machine', async () => {
        infos.set('chat-view', info('chat-view', { status: 'idle' }));
        terminals.set('term-node', null);
        terminals.set('agent-term', terminalAgent('exited', false));
        bound.add('chat-node');
        const result = await asVoice('agents.inspect', {});
        expect(result).toMatchObject({
            status: 'completed',
            output: {
                project: 'Shop',
                connected: true,
                agents: [
                    { id: 'agent-term', kind: 'terminal', status: 'exited', working: false, updatedAt: 42, toolHistory: false },
                    { id: 'chat-view', kind: 'chat', status: 'idle', working: false, toolHistory: true }
                ]
            }
        });
    });

    test('an agent reaches none of these', async () => {
        const call = serverActionCall(host(), PLACE, 'term-node');
        for (const [name, input] of [
            ['workspace.inspect', {}],
            ['agents.inspect', {}],
            ['chat.inspect', { chatId: 'chat-node' }],
            ['target.resolve', { target: 'view', names: null, nodeKind: null, scope: null, machine: null }]
        ] as const) {
            expect(await serverActions.execute(name, input, call)).toMatchObject({ status: 'failed', error: { code: 'forbidden-action' } });
        }
    });
});

describe('chat.send for Voice', () => {
    const writer: VoiceCaller = { ...VOICE, follow: FOLLOW };

    function send(chatId: string, prompt: string, delivery: string | null = null, voice = writer) {
        return serverActions.execute('chat.send', { chatId, prompt, delivery }, voiceActionCall(host(), PLACE, voice));
    }

    test('sends the prompt to a chat that runs, and follows the turn the chat names for it', async () => {
        running.add('chat-node');
        expect(await send('chat-node', '  Run the tests  ', 'queue')).toMatchObject({
            status: 'completed',
            output: { chatId: 'chat-node', chat: 'Builder', queued: true, turnId: 'turn-9' }
        });
        expect(sent).toEqual([{ chatId: 'chat-node', text: 'Run the tests', delivery: 'queue' }]);
        expect(followed).toEqual(['expect chat-node Builder in Shop', 'bind turn-9']);
    });

    test('a send that fails follows nothing', async () => {
        running.add('chat-node');
        sendFails = true;
        expect(await send('chat-node', 'Run the tests')).toMatchObject({ status: 'failed' });
        expect(followed).toEqual(['expect chat-node Builder in Shop', 'drop']);
    });

    test('a chat that does not run, an empty prompt and a chat elsewhere are refused before anything is sent', async () => {
        expect(await send('chat-node', 'Run the tests')).toMatchObject({ status: 'failed', error: { code: 'chat-not-running' } });
        running.add('chat-node');
        expect(await send('chat-node', '   ')).toMatchObject({ status: 'failed', error: { code: 'empty-prompt' } });
        bound.add('chat-node');
        expect(await send('chat-node', 'Run the tests')).toMatchObject({ status: 'failed', error: { code: 'remote-target' } });
        expect(await send('term-node', 'Run the tests')).toMatchObject({ status: 'failed', error: { code: 'not-in-project' } });
        expect([sent, followed]).toEqual([[], []]);
    });
});

describe('chat.clear for Voice', () => {
    const writer: VoiceCaller = { ...VOICE, follow: FOLLOW };

    function clear(chatId: string, voice = writer) {
        return serverActions.execute('chat.clear', { chatId, force: null }, voiceActionCall(host(), PLACE, voice));
    }

    test('asks first, and clears only once the person confirmed, letting go of what Voice followed there', async () => {
        running.add('chat-node');
        const asked = await clear('chat-node');
        expect(asked).toMatchObject({ status: 'needs_confirmation', confirmation: { title: 'Clear AI Chat “Builder”?' } });
        expect(cleared).toEqual([]);
        if (asked.status !== 'needs_confirmation') {
            throw new Error('expected a confirmation');
        }
        expect(await serverActions.confirm(asked.confirmationToken, true, voiceActionCall(host(), PLACE, writer))).toMatchObject({
            status: 'completed',
            output: { chatId: 'chat-node', chat: 'Builder' }
        });
        expect(cleared).toEqual(['chat-node']);
        expect(followed).toEqual(['cleared chat-node']);
    });

    test('a chat view clears the same way, and a cancel clears nothing', async () => {
        running.add('chat-view');
        const asked = await clear('chat-view');
        if (asked.status !== 'needs_confirmation') {
            throw new Error('expected a confirmation');
        }
        expect(await serverActions.confirm(asked.confirmationToken, false, voiceActionCall(host(), PLACE, writer))).toMatchObject({
            status: 'failed',
            error: { code: 'confirmation-declined' }
        });
        expect(cleared).toEqual([]);
    });

    test('a chat of another project, on another machine or not running is refused before anything is asked', async () => {
        expect(await clear('elsewhere')).toMatchObject({ status: 'failed', error: { code: 'not-in-project' } });
        expect(await clear('term-node')).toMatchObject({ status: 'failed', error: { code: 'not-in-project' } });
        expect(await clear('chat-node')).toMatchObject({ status: 'failed', error: { code: 'chat-not-running' } });
        running.add('chat-node');
        bound.add('chat-node');
        expect(await clear('chat-node')).toMatchObject({ status: 'failed', error: { code: 'remote-target' } });
        expect(await clear('chat-node', { ...writer, projectId: 'project-2' })).toMatchObject({ status: 'failed', error: { code: 'remote-target' } });
        bound.delete('chat-node');
        expect(await clear('chat-node', { ...writer, projectId: 'project-2' })).toMatchObject({ status: 'failed', error: { code: 'not-in-project' } });
        expect(cleared).toEqual([]);
    });

    test('a chat that left the project between the question and the answer is not cleared', async () => {
        running.add('chat-node');
        const asked = await clear('chat-node');
        if (asked.status !== 'needs_confirmation') {
            throw new Error('expected a confirmation');
        }
        places.set('chat-node', 'project-2');
        expect(await serverActions.confirm(asked.confirmationToken, true, voiceActionCall(host(), PLACE, writer))).toMatchObject({
            status: 'failed',
            error: { code: 'not-in-project' }
        });
        expect(cleared).toEqual([]);
    });

    test('no other actor clears a chat through this handler', async () => {
        running.add('chat-node');
        expect(await serverActions.execute('chat.clear', { chatId: 'chat-node', force: null }, serverActionCall(host(), PLACE, 'term-node'))).toMatchObject({
            status: 'failed',
            error: { code: 'forbidden-action' }
        });
        const person = { actor: { kind: 'person' as const, id: 'person' }, context: { host: host(), place: PLACE } };
        expect(await serverActions.execute('chat.clear', { chatId: 'chat-node', force: true }, person)).toMatchObject({
            status: 'failed',
            error: { code: 'forbidden-action' }
        });
        expect(cleared).toEqual([]);
    });
});
