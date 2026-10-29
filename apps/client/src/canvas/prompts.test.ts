import { describe, expect, test } from 'bun:test';
import { CHAT_REQUEST_LIMITS, type AgentInfo, type ChatInfo, type ChatItem, type ComputerApproval, type SecretRequest } from '@ruimte/contracts';
import { PROMPT_SAMPLES } from '@adecore/agents-react/testing';
import type { ChatsById } from '@adecore/agents-react/state';
import { endpointKey } from '@/state/keys';
import type { SessionsByKey } from '@/state/sessions';
import { isRuimtePrompt, waitingPrompt } from '@/prompts/ruimte-prompts';
import { canvasPrompts, samePrompts, stackFront, standingRequestsOf, type CanvasPrompt, type CanvasPromptsInput } from './prompts';

const ENDPOINT = 'local';

/* When a snooze in these tests runs out; the stack reads only whether one stands. */
const LATER = 9_999_999_999_999;

/* A chat's own request, or which of Ruimte's own cards it is. */
function kindOf(prompt: CanvasPrompt): string {
    return prompt.subject.kind === 'chat' ? 'chat' : isRuimtePrompt(prompt.subject.prompt) ? prompt.subject.prompt.data.kind : 'host';
}
function key(nodeId: string): string {
    return endpointKey(ENDPOINT, nodeId);
}

const approval = PROMPT_SAMPLES.find((sample) => sample.label === 'Permission · Command')!.items[0]!;
const optional = PROMPT_SAMPLES.find((sample) => sample.label === 'Question · Optional')!.items[0]!;

function chatOf(items: ChatItem[], info: Partial<ChatInfo> = { status: 'needs-you' }): ChatsById[string] {
    const byId = Object.fromEntries(items.map((item) => [item.id, item]));
    return { info: { provider: 'codex', ...info } as ChatInfo, items: byId, structure: byId, order: items.map((item) => item.id) };
}

/* The summary a machine lists in a chat's status for a request that waits. */
function listed(requestId: string, createdAt: number): NonNullable<ChatInfo['requests']>[number] {
    return { requestId, itemId: requestId, kind: 'approval', createdAt };
}

function agent(status: AgentInfo['status'], updatedAt: number): AgentInfo {
    return {
        kind: 'claude',
        agentSessionId: 'session',
        transcriptPath: null,
        status,
        live: true,
        updatedAt
    };
}

function node(id: string, kind: 'chat' | 'terminal' | 'note') {
    return { id, kind, title: id };
}

function input(overrides: Partial<CanvasPromptsInput> = {}): CanvasPromptsInput {
    return {
        nodes: [node('api', 'terminal'), node('docs', 'chat'), node('ios', 'terminal'), node('merge', 'chat'), node('note', 'note')],
        endpointId: ENDPOINT,
        sessions: {
            [key('api')]: { attached: true, agent: agent('needs-you', 100) },
            [key('ios')]: { attached: true, agent: agent('needs-you', 400) }
        } satisfies SessionsByKey,
        chats: {
            [key('docs')]: chatOf([{ ...optional, id: 'docs-q', requestId: 'docs-q', createdAt: 50 }]),
            [key('merge')]: chatOf([{ ...approval, id: 'merge-a', requestId: 'merge-a', createdAt: 300 }])
        },
        computer: [],
        waitingSince: new Map(),
        ...overrides
    };
}

function computerCard(nodeId: string, createdAt: number): ComputerApproval {
    return {
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
    };
}

describe('canvasPrompts', () => {
    test('a terminal card carries the actual approval instead of an empty waiting placeholder', () => {
        const base = input();
        const request = {
            id: 'permission',
            source: '',
            kind: 'approval' as const,
            toolName: 'Bash',
            title: 'Publish the branch',
            text: 'git push',
            createdAt: 500
        };
        const sessions = { ...base.sessions, [key('ios')]: { attached: false, agent: { ...agent('needs-you', 500), requests: [request] } } };
        const collected = canvasPrompts({ ...base, sessions });
        const card = collected.prompts.find((prompt) => prompt.title === 'ios')!;
        expect(card.subject).toEqual({ kind: 'host', nodeId: 'ios', prompt: waitingPrompt('ios', 500, request) });
        expect(samePrompts(collected.prompts, canvasPrompts({ ...base, sessions }).prompts)).toBe(true);
        const repeatedRequest = { ...request };
        const repeated = { ...sessions, [key('ios')]: { attached: false, agent: { ...agent('needs-you', 500), requests: [repeatedRequest] } } };
        expect(samePrompts(collected.prompts, canvasPrompts({ ...base, sessions: repeated }).prompts)).toBe(true);
        repeatedRequest.text = 'git push origin main';
        expect(samePrompts(collected.prompts, canvasPrompts({ ...base, sessions: repeated }).prompts)).toBe(false);
    });

    test('prompts come blocking first, oldest first, with an optional question last', () => {
        const { prompts } = canvasPrompts(input());
        expect(prompts.map((prompt) => [kindOf(prompt), prompt.title])).toEqual([
            ['terminal-waiting', 'api'],
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
        expect(prompts.map((prompt) => [kindOf(prompt), prompt.title, prompt.surface])).toEqual([
            ['computer-approval', 'docs', 'chat'],
            ['computer-approval', 'ios', 'terminal'],
            ['terminal-waiting', 'api', 'terminal'],
            ['chat', 'merge', 'chat'],
            ['terminal-waiting', 'ios', 'terminal'],
            ['chat', 'docs', 'chat']
        ]);
    });

    test('a secret card stands on the chat that asks, never on a terminal, blocking', () => {
        const card = (nodeId: string, createdAt: number): SecretRequest => ({
            requestId: `secret-${nodeId}`,
            nodeId,
            projectId: 'p1',
            launchId: 'api',
            launchName: 'API',
            variable: 'API_KEY',
            label: 'Stripe key',
            reason: 'Checkout',
            replaces: false,
            createdAt,
            expiresAt: createdAt + 900_000
        });
        const { prompts } = canvasPrompts(input({ secrets: [card('docs', 10), card('ios', 20)] }));
        expect(prompts.map((prompt) => [kindOf(prompt), prompt.title, prompt.surface]).slice(0, 2)).toEqual([
            ['secret-request', 'docs', 'chat'],
            ['terminal-waiting', 'api', 'terminal']
        ]);
        expect(prompts.some((prompt) => kindOf(prompt) === 'secret-request' && prompt.title === 'ios')).toBe(false);
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
        const sessions = { ...base.sessions, [key('api')]: { attached: true, agent: agent('running', 500) } };
        const { prompts } = canvasPrompts({ ...base, chats, sessions });
        expect(prompts.map((prompt) => prompt.title)).toEqual(['ios', 'docs']);
    });

    test('a waiting terminal keeps the time it was first seen waiting, and loses it once it stops', () => {
        const first = canvasPrompts(input());
        expect(first.waitingSince.get(key('ios'))).toBe(400);
        const later = input({ waitingSince: first.waitingSince });
        later.sessions = { ...later.sessions, [key('ios')]: { attached: true, agent: agent('needs-you', 900) } };
        const second = canvasPrompts(later);
        const waiting = second.prompts.find((prompt) => kindOf(prompt) === 'terminal-waiting' && prompt.title === 'ios')!;
        expect(waiting.subject).toEqual({ kind: 'host', nodeId: 'ios', prompt: waitingPrompt('ios', 400) });
        later.sessions = { ...later.sessions, [key('ios')]: { attached: true, agent: agent('running', 950) } };
        expect(canvasPrompts({ ...later, waitingSince: second.waitingSince }).waitingSince.has(key('ios'))).toBe(false);
    });

    test('the prompts of a snoozed chat or terminal leave the stack for the snoozed list, in the same order', () => {
        const { prompts, snoozed } = canvasPrompts(input({ snoozes: { [key('docs')]: LATER, [key('api')]: LATER } }));
        expect(prompts.map((prompt) => prompt.title)).toEqual(['merge', 'ios']);
        expect(snoozed.map((prompt) => [prompt.title, prompt.ownerId])).toEqual([
            ['api', 'api'],
            ['docs', 'docs']
        ]);
    });

    test("a design's later chat and a sub-agent's question belong to the node on the canvas, and go with its snooze", () => {
        const design = {
            id: 'design',
            kind: 'design' as const,
            title: 'Design',
            chats: [{ id: 'design-chat-2', name: 'Second', node: { kind: 'chat', provider: 'claude' } }]
        };
        const question = { ...optional, id: 'sub-q', requestId: 'sub-q', createdAt: 20 };
        const base = input({
            nodes: [design, node('docs', 'chat')],
            chats: { [key('design-chat-2')]: chatOf([{ ...approval, id: 'later-a', requestId: 'later-a', createdAt: 10 }]) },
            descendants: new Map([[key('docs'), [{ kind: 'chat', nodeId: 'sub-agent', item: question }]]])
        });
        const owners = canvasPrompts(base).prompts.map((prompt) => [prompt.title, prompt.ownerId]);
        expect(owners).toEqual([
            ['Second', 'design'],
            ['docs', 'docs']
        ]);
        const { prompts, snoozed } = canvasPrompts({ ...base, snoozes: { [key('design')]: LATER, [key('docs')]: LATER } });
        expect(prompts).toEqual([]);
        expect(snoozed.map((prompt) => prompt.ownerId)).toEqual(['design', 'docs']);
    });

    test('a snooze counts on the machine its node runs on', () => {
        const remote = { ...node('docs', 'chat'), machine: 'other' };
        const chats = { [endpointKey('other', 'docs')]: chatOf([{ ...approval, id: 'docs-a', requestId: 'docs-a', createdAt: 10 }]) };
        const here = canvasPrompts(input({ nodes: [remote], chats, snoozes: { [key('docs')]: LATER } }));
        const there = canvasPrompts(input({ nodes: [remote], chats, snoozes: { [endpointKey('other', 'docs')]: LATER } }));
        expect(here.prompts).toHaveLength(1);
        expect(there.snoozed).toHaveLength(1);
    });
});

describe('standingRequestsOf', () => {
    const first = { ...approval, id: 'first', requestId: 'first', createdAt: 100 } as ChatItem;
    const second = { ...approval, id: 'second', requestId: 'second', createdAt: 200 } as ChatItem;

    test('a thread held from before its chat went idle waits on nothing', () => {
        expect(standingRequestsOf(chatOf([first], { status: 'idle' }))).toEqual([]);
    });

    test('a request the status no longer lists is answered, though the thread still holds it as waiting', () => {
        const chat = chatOf([first, second], { status: 'needs-you', requests: [listed('second', 200)] });
        expect(standingRequestsOf(chat).map((request) => request.requestId)).toEqual(['second']);
    });

    test('a machine that lists no requests, or a full list, leaves the thread to say', () => {
        expect(standingRequestsOf(chatOf([first, second])).map((request) => request.requestId)).toEqual(['first', 'second']);
        const full = Array.from({ length: CHAT_REQUEST_LIMITS.perChat }, (_, i) => listed(`other-${i}`, i));
        expect(standingRequestsOf(chatOf([first], { status: 'needs-you', requests: full })).map((request) => request.requestId)).toEqual(['first']);
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
        const chats = {
            ...base.chats,
            [key('merge')]: chatOf([
                { ...approval, id: 'merge-a', requestId: 'merge-a', createdAt: 300 },
                { ...approval, id: 'merge-b', requestId: 'merge-b', createdAt: 350 }
            ])
        };
        expect(samePrompts(canvasPrompts(stable).prompts, canvasPrompts({ ...stable, chats }).prompts)).toBe(false);
    });
});
