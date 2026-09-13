import { afterEach, describe, expect, test } from 'bun:test';
import type { AgentInfo, AgentStatus } from '@ruimte/contracts';
import { useChats, type ChatState } from '@/state/chats';
import { useSessions, type SessionState } from '@/state/sessions';
import { useSettings } from '@/state/settings';
import { keepAwakeWanted, startKeepAwake } from '@/state/keep-awake';

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

describe('what the shell is told', () => {
    const working = (status: AgentStatus): void => {
        useSessions.setState({ byKey: { 'local:t1': session(agent(status)) } });
    };

    afterEach(() => {
        useSessions.setState({ byKey: {} });
        useChats.setState({ byKey: {} });
        useSettings.setState({ agentsKeepAwake: false });
    });

    test('nothing at all in a browser, which has no shell to ask', () => {
        expect(startKeepAwake(undefined)).toBeNull();
    });

    test('true when an agent starts and false when it settles', () => {
        const told: boolean[] = [];
        const stop = startKeepAwake((keep) => told.push(keep));
        useSettings.setState({ agentsKeepAwake: true });
        working('running');
        working('idle');
        stop?.();
        expect(told).toEqual([true, false]);
    });

    test('once per change, not once per event the stores see', () => {
        const told: boolean[] = [];
        const stop = startKeepAwake((keep) => told.push(keep));
        useSettings.setState({ agentsKeepAwake: true });
        working('running');
        useChats.setState({ byKey: { 'local:c1': chat('running') } });
        working('running');
        stop?.();
        expect(told).toEqual([true, false]);
    });

    test('the setting turned off mid-turn reaches the shell', () => {
        const told: boolean[] = [];
        useSettings.setState({ agentsKeepAwake: true });
        const stop = startKeepAwake((keep) => told.push(keep));
        working('running');
        useSettings.setState({ agentsKeepAwake: false });
        stop?.();
        expect(told).toEqual([true, false]);
    });

    test('the block goes with the watcher, so a teardown never leaves one behind', () => {
        const told: boolean[] = [];
        useSettings.setState({ agentsKeepAwake: true });
        const stop = startKeepAwake((keep) => told.push(keep));
        working('running');
        stop?.();
        expect(told).toEqual([true, false]);
    });
});
