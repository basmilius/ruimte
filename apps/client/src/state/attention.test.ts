import { describe, expect, test } from 'bun:test';
import type { AgentInfo, AgentStatus } from '@ruimte/contracts';
import { attentionTotal, groupAttention, isUnseen, nextUnseen, readableNodes, seenNodes, settledSince, type AttentionPass } from '@/state/attention';
import type { ChatState } from '@/state/chats';
import type { SessionState, StatusOf } from '@/state/sessions';

const pass = (input: Partial<AttentionPass>): AttentionPass => ({
    working: new Set(),
    previous: new Set(),
    needsYou: new Set(),
    seen: new Set(),
    unseen: new Set(),
    known: new Set(['local:a', 'local:b']),
    ...input
});

const agent = (status: AgentStatus, live = true): AgentInfo => ({
    kind: 'claude',
    agentSessionId: 'a1',
    transcriptPath: null,
    status,
    live,
    updatedAt: 0
});

const session = (agentInfo?: AgentInfo, attached = true): SessionState => ({ attached, agent: agentInfo });

const chat = (status: AgentStatus): ChatState => ({
    info: {
        chatId: 'c1',
        provider: 'claude',
        cwd: '/',
        agentSessionId: null,
        model: null,
        selection: { model: 'claude-sonnet-5', options: {} },
        runtimeMode: 'full-access',
        status,
        running: true,
        activeTurnId: null,
        slashCommands: [],
        usage: { contextTokens: 0, contextWindow: null, costUsd: 0, turns: 0 },
        createdAt: 0
    },
    items: {},
    order: []
});

const node = (id: string, size = 200): { id: string; x: number; y: number; w: number; h: number } => ({ id, x: 0, y: 0, w: size, h: size });

describe('what a person can read on a canvas', () => {
    const canvas = { camera: { x: 0, y: 0, zoom: 1 }, viewport: { w: 1000, h: 800 }, nodes: [node('a'), { ...node('b'), x: 4000 }] };

    test('a node in front of the camera, and not the one beside it', () => {
        expect(readableNodes(canvas)).toEqual(['a']);
    });

    test('nothing at all while the editor has no size, since it has drawn nothing yet', () => {
        expect(readableNodes({ ...canvas, viewport: { w: 0, h: 0 } })).toEqual([]);
    });

    test('nothing zoomed further out than reading, where a node is a shape', () => {
        expect(readableNodes({ ...canvas, camera: { x: 0, y: 0, zoom: 0.2 } })).toEqual([]);
    });

    test('nothing folded into a collapsed group', () => {
        expect(readableNodes({ ...canvas, hidden: new Set(['a']) })).toEqual([]);
    });

    test('a node past the edge of the viewport is not read, however close', () => {
        expect(readableNodes({ ...canvas, camera: { x: -1400, y: 0, zoom: 1 } })).toEqual([]);
    });
});

describe('what counts as seen', () => {
    test('the nodes of every view standing in a cell, focused or not', () => {
        expect([...seenNodes(true, [['a'], ['b', 'c']])]).toEqual(['a', 'b', 'c']);
    });

    test('nothing while another window has the keyboard', () => {
        expect(seenNodes(false, [['a'], ['b']]).size).toBe(0);
    });
});

describe('which turns ended', () => {
    test('an agent that was working and is not any more', () => {
        expect(settledSince(pass({ previous: new Set(['local:a']) }))).toEqual(['local:a']);
    });

    test('one that is still working did not', () => {
        expect(settledSince(pass({ previous: new Set(['local:a']), working: new Set(['local:a']) }))).toEqual([]);
    });

    test('one that stopped to ask something did not: that is a person turn, and needs-you says so', () => {
        expect(settledSince(pass({ previous: new Set(['local:a']), needsYou: new Set(['local:a']) }))).toEqual([]);
    });

    test('a node that left the project did not end a turn, it went', () => {
        expect(settledSince(pass({ previous: new Set(['local:gone']) }))).toEqual([]);
    });
});

describe('the marks', () => {
    test('a turn that ended out of sight leaves one', () => {
        expect([...nextUnseen(pass({ previous: new Set(['local:a']) }))]).toEqual(['local:a']);
    });

    test('a turn that ended in front of a person leaves none', () => {
        expect(nextUnseen(pass({ previous: new Set(['local:a']), seen: new Set(['local:a']) })).size).toBe(0);
    });

    test('looking at a marked node takes the mark off', () => {
        expect(nextUnseen(pass({ unseen: new Set(['local:a']), seen: new Set(['local:a']) })).size).toBe(0);
    });

    test('a mark stays until somebody looks, however many passes go by', () => {
        expect([...nextUnseen(pass({ unseen: new Set(['local:a']) }))]).toEqual(['local:a']);
    });

    test('an agent that starts working again drops its mark, which is about the turn before', () => {
        expect(nextUnseen(pass({ unseen: new Set(['local:a']), working: new Set(['local:a']) })).size).toBe(0);
    });

    test('a node that starts asking drops it too, since the needs-you count takes over', () => {
        expect(nextUnseen(pass({ unseen: new Set(['local:a']), needsYou: new Set(['local:a']) })).size).toBe(0);
    });

    test('a node that left the project takes its mark with it', () => {
        expect(nextUnseen(pass({ unseen: new Set(['local:gone']) })).size).toBe(0);
    });

    test('a mark is about one node on one machine, which is what the row that draws it asks', () => {
        const unseen = { 'local:a': true } as const;
        expect(isUnseen(unseen, 'local', 'a')).toBe(true);
        expect(isUnseen(unseen, 'other', 'a')).toBe(false);
        expect(isUnseen(unseen, 'local', 'b')).toBe(false);
    });
});

describe('the counts', () => {
    const nodes: StatusOf[] = [
        { id: 't1', kind: 'terminal' },
        { id: 't2', kind: 'terminal' },
        { id: 'c1', kind: 'chat' }
    ];

    test('a shell somebody left attached is no agent working', () => {
        const groups = groupAttention(nodes, { 'local:t1': session(), 'local:t2': session() }, {}, 'local', {});
        expect(groups.working).toEqual([]);
    });

    test('an agent in the middle of a turn is, on a terminal and in a chat alike', () => {
        const groups = groupAttention(nodes, { 'local:t1': session(agent('running')) }, { 'local:c1': chat('running') }, 'local', {});
        expect(groups.working).toEqual(['t1', 'c1']);
    });

    test('a node that waits on a person counts there and nowhere else', () => {
        const groups = groupAttention(nodes, { 'local:t1': session(agent('needs-you')) }, {}, 'local', { 'local:t1': true });
        expect(groups.needsYou).toEqual(['t1']);
        expect(groups.finished).toEqual([]);
    });

    test('a marked node counts as finished', () => {
        const groups = groupAttention(nodes, {}, {}, 'local', { 'local:t2': true });
        expect(groups.finished).toEqual(['t2']);
    });

    test('a mark of another machine is about another node than the one on screen', () => {
        expect(groupAttention(nodes, {}, {}, 'local', { 'Xk3p:t2': true }).finished).toEqual([]);
    });

    test('the badge is everything waiting to be looked at, and never the same node twice', () => {
        const groups = groupAttention(nodes, { 'local:t1': session(agent('needs-you')), 'local:t2': session(agent('running')) }, {}, 'local', {
            'local:t1': true,
            'local:c1': true
        });
        expect(attentionTotal(groups)).toBe(2);
    });
});
