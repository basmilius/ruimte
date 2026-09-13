import { describe, expect, test } from 'bun:test';
import type { AgentInfo, AgentStatus } from '@ruimte/contracts';
import type { ChatState } from '@/state/chats';
import type { SessionState } from '@/state/sessions';
import { keepAwakeWanted } from '@/state/keep-awake';

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
