import { beforeEach, describe, expect, test } from 'bun:test';
import type { ChatItem, ProjectContent } from '@ruimte/contracts';
import type { CanvasHost } from '../canvas/verb.ts';
import { serverActionCall, voiceActionCall, type VoiceCaller } from './context.ts';
import { serverActions } from './server-actions.ts';

const PLACE = { projectId: 'project-1', folder: '/work/app', canvasId: 'main' };
const VOICE: VoiceCaller = {
    sessionId: 'session-1',
    owner: { clientId: 'client-1', sceneId: 'scene-1' },
    projectId: 'project-1',
    timeZone: 'Europe/Amsterdam',
    writes: false
};

const CONTENT = {
    views: [
        {
            id: 'main',
            kind: 'canvas',
            name: 'Main',
            nodes: [
                { id: 'chat-node', kind: 'chat', title: 'Builder', x: 0, y: 0, w: 400, h: 300 },
                { id: 'term-node', kind: 'terminal', title: 'Shell', x: 0, y: 0, w: 400, h: 300 }
            ],
            edges: []
        },
        { id: 'chat-view', kind: 'chat', name: 'Planning' }
    ]
} as unknown as ProjectContent;

let loaded: Map<string, ChatItem[]>;
let stored: Map<string, ChatItem[]>;
let bound: Set<string>;
let places: Map<string, string>;
let reads: string[];

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
            }
        },
        chatThreads: { items: async (chatId) => loaded.get(chatId) ?? stored.get(chatId) ?? null }
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
});

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
