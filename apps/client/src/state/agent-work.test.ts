import { describe, expect, test } from 'bun:test';
import type { AgentInfo, AgentStatus } from '@ruimte/contracts';
import { agentsWorking, nodeWorking } from '@/state/agent-work';
import type { ChatState } from '@ruimte/agents-react/state/chats';
import type { SessionState, StatusOf } from '@/state/sessions';

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
    structure: {},
    order: []
});

describe('what counts as an agent working', () => {
    test('a shell somebody is typing in does not, however attached it is', () => {
        expect(agentsWorking({ 'local:t1': session() }, {})).toBe(false);
    });

    test('a session whose agent is running does', () => {
        expect(agentsWorking({ 'local:t1': session(agent('running')) }, {})).toBe(true);
    });

    test('an agent that is waiting on a person does not', () => {
        expect(agentsWorking({ 'local:t1': session(agent('needs-you')) }, {})).toBe(false);
        expect(agentsWorking({ 'local:t1': session(agent('idle')) }, {})).toBe(false);
    });

    test('a record left behind by a CLI that went down does not, whatever status it kept', () => {
        expect(agentsWorking({ 'local:t1': session(agent('running', false), false) }, {})).toBe(false);
    });

    test('a chat in the middle of a turn does', () => {
        expect(agentsWorking({}, { 'local:c1': chat('running') })).toBe(true);
        expect(agentsWorking({}, { 'local:c1': chat('idle') })).toBe(false);
    });

    test('one agent on another machine is enough, since the window is watching it either way', () => {
        expect(agentsWorking({ 'local:t1': session(agent('idle')), 'Xk3p:t2': session(agent('running')) }, {})).toBe(true);
    });

    test('nothing open is nothing to stay awake for', () => {
        expect(agentsWorking({}, {})).toBe(false);
    });
});

describe('which node the working agent is in', () => {
    const terminal: StatusOf = { id: 't1', kind: 'terminal' };
    const thread: StatusOf = { id: 'c1', kind: 'chat' };

    test('a terminal reads the agent of its own session on its own machine', () => {
        const sessions = { 'local:t1': session(agent('running')), 'Xk3p:t1': session(agent('idle')) };
        expect(nodeWorking(terminal, sessions, {}, 'local')).toBe(true);
        expect(nodeWorking(terminal, sessions, {}, 'Xk3p')).toBe(false);
    });

    test('an attached shell with no agent in it is not a working node', () => {
        expect(nodeWorking(terminal, { 'local:t1': session() }, {}, 'local')).toBe(false);
    });

    test('a chat reads its thread', () => {
        expect(nodeWorking(thread, {}, { 'local:c1': chat('running') }, 'local')).toBe(true);
        expect(nodeWorking(thread, {}, { 'local:c1': chat('needs-you') }, 'local')).toBe(false);
    });

    test('a node that is no agent never works, whatever status it carries', () => {
        expect(nodeWorking({ id: 'b1', kind: 'browser', status: 'running' }, {}, {}, 'local')).toBe(false);
    });
});
