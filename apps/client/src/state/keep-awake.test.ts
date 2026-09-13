import { describe, expect, test } from 'bun:test';
import type { AgentInfo, AgentStatus } from '@ruimte/contracts';
import type { ChatState } from '@/state/chats';
import type { SessionState } from '@/state/sessions';
import { agentsWorking, keepAwakeWanted } from '@/state/keep-awake';

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

describe('the block itself', () => {
    const busy = { 'local:t1': session(agent('running')) };

    test('is never asked for while the setting is off', () => {
        expect(keepAwakeWanted(false, busy, { 'local:c1': chat('running') })).toBe(false);
    });

    test('is asked for the moment an agent works and the setting is on', () => {
        expect(keepAwakeWanted(true, busy, {})).toBe(true);
    });

    test('is dropped again once the last agent settles', () => {
        expect(keepAwakeWanted(true, { 'local:t1': session(agent('idle')) }, {})).toBe(false);
    });
});
