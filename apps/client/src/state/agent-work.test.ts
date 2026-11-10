import { describe, expect, test } from 'bun:test';
import type { ChatState } from '@adecore/agents-react/state';
import type { AgentInfo, AgentStatus, Task } from '@ruimte/contracts';
import { agentsWorking, nodeWork, nodeWorking } from '@/state/agent-work';
import type { SessionState, StatusOf } from '@/state/sessions';
import { chatInfoOf } from '../../testing/chat-info';

function agent(status: AgentStatus, live = true): AgentInfo {
    return {
        kind: 'claude',
        agentSessionId: 'a1',
        transcriptPath: null,
        status,
        live,
        updatedAt: 0
    };
}

function session(agentInfo?: AgentInfo, attached = true): SessionState {
    return { attached, agent: agentInfo };
}

function chat(status: AgentStatus, delegating?: boolean): ChatState {
    return { info: chatInfoOf('c1', { status, delegating }), items: {}, structure: {}, order: [] };
}

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

    test('a chat between turns does while sub-agents of its CLI go on', () => {
        expect(agentsWorking({}, { 'local:c1': chat('idle', true) })).toBe(true);
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

    test('a chat between turns works through its sub-agents, unless it waits on a person', () => {
        expect(nodeWork(thread, {}, { 'local:c1': chat('running', true) }, 'local')).toBe('turn');
        expect(nodeWork(thread, {}, { 'local:c1': chat('idle', true) }, 'local')).toBe('delegating');
        expect(nodeWork(thread, {}, { 'local:c1': chat('needs-you', true) }, 'local')).toBeNull();
        expect(nodeWorking(thread, {}, { 'local:c1': chat('idle', true) }, 'local')).toBe(true);
    });

    test('a chat between turns works through a command it left running, unless it waits on a person, works or delegates', () => {
        const background = [{ id: 'b1', kind: 'shell' as const, description: 'Dev server', command: 'bun dev', startedAt: 1 }];

        expect(nodeWork(thread, {}, { 'local:c1': { info: chatInfoOf('c1', { status: 'idle', background }) } }, 'local')).toBe('background');
        expect(nodeWork(thread, {}, { 'local:c1': { info: chatInfoOf('c1', { status: 'idle', background, delegating: true }) } }, 'local')).toBe('delegating');
        expect(nodeWork(thread, {}, { 'local:c1': { info: chatInfoOf('c1', { status: 'running', background }) } }, 'local')).toBe('turn');
        expect(nodeWork(thread, {}, { 'local:c1': { info: chatInfoOf('c1', { status: 'needs-you', background }) } }, 'local')).toBeNull();
        expect(agentsWorking({}, { 'local:c1': { info: chatInfoOf('c1', { status: 'idle', background }) } })).toBe(false);
    });

    test('a chat between turns works through a child agent whose task is open', () => {
        const task: Task = {
            id: 'k1',
            projectId: 'p1',
            parentId: 'c1',
            childId: 'c2',
            title: 'Review',
            prompt: '',
            status: 'open',
            result: null,
            createdAt: 1,
            settledAt: null,
            wake: 'pending'
        };
        const chats = { 'local:c1': chat('idle') };

        expect(nodeWork(thread, {}, chats, 'local', { k1: task })).toBe('delegating');
        expect(nodeWork(thread, {}, chats, 'local', { k1: { ...task, status: 'done' } })).toBeNull();
        expect(nodeWork(thread, {}, chats, 'local')).toBeNull();
    });

    test('a node that is no agent never works, whatever status it carries', () => {
        expect(nodeWorking({ id: 'b1', kind: 'browser', status: 'running' }, {}, {}, 'local')).toBe(false);
    });
});
