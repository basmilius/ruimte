import { describe, expect, test } from 'bun:test';
import type { AgentInfo, AgentStatus } from '@ruimte/contracts';
import { childCounter, isIdle, workOf } from './work.ts';

const agent = (status: AgentStatus, live = true): AgentInfo => ({
    kind: 'claude',
    agentSessionId: 'agent-1',
    transcriptPath: null,
    status,
    live,
    updatedAt: 0
});

const shell = (pid: number, options: { exited?: boolean; agent?: AgentInfo | null } = {}) => ({
    pid,
    exited: options.exited ?? false,
    agent: options.agent ?? null
});

describe('workOf', () => {
    test('a shell with nothing running in it is idle', () => {
        const work = workOf({ sessions: [shell(10)], chats: [], children: () => 0 });
        expect(work).toEqual({ terminals: 0, agents: 0 });
        expect(isIdle(work)).toBe(true);
    });

    test('a shell with a foreground process is a running terminal', () => {
        const children = childCounter([{ pid: 11, ppid: 10 }]);
        expect(workOf({ sessions: [shell(10), shell(20)], chats: [], children })).toEqual({ terminals: 1, agents: 0 });
    });

    test('a terminal agent in a turn, or waiting on a person in one, is an agent', () => {
        const sessions = [shell(10, { agent: agent('running') }), shell(20, { agent: agent('needs-you') })];
        expect(workOf({ sessions, chats: [], children: () => 1 })).toEqual({ terminals: 0, agents: 2 });
    });

    test('an agent between turns still holds its terminal', () => {
        const work = workOf({ sessions: [shell(10, { agent: agent('idle') })], chats: [], children: () => 1 });
        expect(work).toEqual({ terminals: 1, agents: 0 });
    });

    test('an agent that did not come back after a restart is not in a turn', () => {
        const work = workOf({ sessions: [shell(10, { agent: agent('running', false) })], chats: [], children: () => 0 });
        expect(isIdle(work)).toBe(true);
    });

    test('an exited shell is nothing', () => {
        expect(isIdle(workOf({ sessions: [shell(10, { exited: true })], chats: [], children: null }))).toBe(true);
    });

    test('a chat with a turn in flight is an agent, one without is not', () => {
        expect(workOf({ sessions: [], chats: [{ activeTurnId: 'turn-1' }, { activeTurnId: null }], children: () => 0 })).toEqual({
            terminals: 0,
            agents: 1
        });
    });

    test('without a process table a live shell counts as running', () => {
        expect(workOf({ sessions: [shell(10)], chats: [], children: null })).toEqual({ terminals: 1, agents: 0 });
    });
});
