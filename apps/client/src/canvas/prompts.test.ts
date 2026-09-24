import { describe, expect, test } from 'bun:test';
import type { AgentInfo, ApprovalRequest, ChatInfo, ChatItem, ComputerApproval } from '@ruimte/contracts';
import { PROMPT_SAMPLES } from '@/prompts/logic/prompts.fixtures';
import type { ChatsById } from '@/state/chats';
import { endpointKey } from '@/state/keys';
import type { SessionsByKey } from '@/state/sessions';
import { canvasPrompts, samePrompts, stackFront, type CanvasPromptsInput } from './prompts';

const ENDPOINT = 'local';
const key = (nodeId: string): string => endpointKey(ENDPOINT, nodeId);

const approval = PROMPT_SAMPLES.find((sample) => sample.label === 'Permission · Command')!.items[0]!;
const optional = PROMPT_SAMPLES.find((sample) => sample.label === 'Question · Optional')!.items[0]!;

const chatOf = (items: ChatItem[]): ChatsById[string] => {
    const byId = Object.fromEntries(items.map((item) => [item.id, item]));
    return { info: { provider: 'codex' } as ChatInfo, items: byId, structure: byId, order: items.map((item) => item.id) };
};

const agent = (status: AgentInfo['status'], updatedAt: number): AgentInfo => ({
    kind: 'claude',
    agentSessionId: 'session',
    transcriptPath: null,
    status,
    live: true,
    updatedAt
});

const request = (requestId: string, createdAt: number): ApprovalRequest => ({
    requestId,
    sessionId: 'api',
    toolName: 'Bash',
    summary: 'bun test',
    choices: [{ id: 'allow', kind: 'allow', label: 'Allow' }],
    createdAt,
    expiresAt: createdAt + 110_000
});

const node = (id: string, kind: 'chat' | 'terminal' | 'note') => ({ id, kind, title: id });

const input = (overrides: Partial<CanvasPromptsInput> = {}): CanvasPromptsInput => ({
    nodes: [node('api', 'terminal'), node('docs', 'chat'), node('ios', 'terminal'), node('merge', 'chat'), node('note', 'note')],
    endpointId: ENDPOINT,
    sessions: {
        [key('api')]: { attached: true, agent: agent('needs-you', 100), approvals: [request('api-1', 100)] },
        [key('ios')]: { attached: true, agent: agent('needs-you', 400) }
    } satisfies SessionsByKey,
    chats: {
        [key('docs')]: chatOf([{ ...optional, id: 'docs-q', requestId: 'docs-q', createdAt: 50 }]),
        [key('merge')]: chatOf([{ ...approval, id: 'merge-a', requestId: 'merge-a', createdAt: 300 }])
    },
    approvalsOffered: true,
    computer: [],
    waitingSince: new Map(),
    ...overrides
});

const computerCard = (nodeId: string, createdAt: number): ComputerApproval => ({
    requestId: `computer-${nodeId}`,
    nodeId,
    surface: 'chat',
    nodeTitle: nodeId,
    projectId: 'p1',
    projectName: 'Ruimte',
    app: { name: 'TextEdit', bundleId: 'com.example.textedit' },
    command: 'state',
    createdAt,
    expiresAt: createdAt + 600_000
});

describe('canvasPrompts', () => {
    test('four kinds of prompt come blocking first, oldest first, with an optional question last', () => {
        const { prompts } = canvasPrompts(input());
        expect(prompts.map((prompt) => [prompt.subject.kind, prompt.title])).toEqual([
            ['terminal-approval', 'api'],
            ['chat', 'merge'],
            ['terminal-waiting', 'ios'],
            ['chat', 'docs']
        ]);
        expect(prompts.map((prompt) => [prompt.surface, prompt.provider])).toEqual([
            ['terminal', 'claude'],
            ['chat', 'codex'],
            ['terminal', 'claude'],
            ['chat', 'codex']
        ]);
    });

    test('a computer use card stands on the chat or terminal whose agent asks, blocking like a permission', () => {
        const { prompts } = canvasPrompts(input({ computer: [computerCard('docs', 10), computerCard('ios', 20), computerCard('elsewhere', 5)] }));
        expect(prompts.map((prompt) => [prompt.subject.kind, prompt.title, prompt.surface])).toEqual([
            ['computer-approval', 'docs', 'chat'],
            ['computer-approval', 'ios', 'terminal'],
            ['terminal-approval', 'api', 'terminal'],
            ['chat', 'merge', 'chat'],
            ['terminal-waiting', 'ios', 'terminal'],
            ['chat', 'docs', 'chat']
        ]);
    });

    test('nodes of another canvas are not asked about', () => {
        const { prompts } = canvasPrompts(input({ nodes: [node('merge', 'chat')] }));
        expect(prompts.map((prompt) => prompt.title)).toEqual(['merge']);
    });

    test('an answered prompt is gone with the state that held it', () => {
        const base = input();
        const chats = {
            ...base.chats,
            [key('merge')]: chatOf([{ ...approval, id: 'merge-a', requestId: 'merge-a', createdAt: 300, decision: 'allow' } as ChatItem])
        };
        const sessions = { ...base.sessions, [key('api')]: { attached: true, agent: agent('running', 500), approvals: [] } };
        const { prompts } = canvasPrompts({ ...base, chats, sessions });
        expect(prompts.map((prompt) => prompt.title)).toEqual(['ios', 'docs']);
    });

    test('with approvals off a terminal that asks is a waiting card instead', () => {
        const { prompts } = canvasPrompts(input({ approvalsOffered: false }));
        expect(prompts.filter((prompt) => prompt.surface === 'terminal').map((prompt) => [prompt.subject.kind, prompt.title])).toEqual([
            ['terminal-waiting', 'api'],
            ['terminal-waiting', 'ios']
        ]);
    });

    test('a waiting terminal keeps the time it was first seen waiting, and loses it once it stops', () => {
        const first = canvasPrompts(input());
        expect(first.waitingSince.get(key('ios'))).toBe(400);
        const later = input({ waitingSince: first.waitingSince });
        later.sessions = { ...later.sessions, [key('ios')]: { attached: true, agent: agent('needs-you', 900) } };
        const second = canvasPrompts(later);
        const waiting = second.prompts.find((prompt) => prompt.subject.kind === 'terminal-waiting')!;
        expect(waiting.subject).toEqual({ kind: 'terminal-waiting', nodeId: 'ios', since: 400 });
        later.sessions = { ...later.sessions, [key('ios')]: { attached: true, agent: agent('running', 950) } };
        expect(canvasPrompts({ ...later, waitingSince: second.waitingSince }).waitingSince.has(key('ios'))).toBe(false);
    });
});

describe('stackFront', () => {
    test('the card being read stays in front, and an answered one hands its place to the next', () => {
        expect(stackFront(['a', 'b', 'c'], null, 0)).toBe('a');
        expect(stackFront(['new', 'a', 'b'], 'b', 1)).toBe('b');
        expect(stackFront(['a', 'c'], 'b', 1)).toBe('c');
        expect(stackFront(['a'], 'b', 1)).toBe('a');
        expect(stackFront([], 'b', 1)).toBeNull();
    });
});

describe('samePrompts', () => {
    test('two readings of the same state are the same stack, and a new request is not', () => {
        const first = canvasPrompts(input());
        const base = input();
        const stable = { ...base, waitingSince: first.waitingSince };
        expect(samePrompts(canvasPrompts(stable).prompts, canvasPrompts(stable).prompts)).toBe(true);
        const sessions = { ...base.sessions, [key('api')]: { attached: true, agent: agent('needs-you', 100), approvals: [request('api-2', 150)] } };
        expect(samePrompts(canvasPrompts(stable).prompts, canvasPrompts({ ...stable, sessions }).prompts)).toBe(false);
    });
});
