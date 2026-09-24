import { afterEach, describe, expect, test } from 'bun:test';
import type { AgentInfo, AgentStatus } from '@ruimte/contracts';
import { useChats, type ChatState } from '@/state/chats';
import { useSessions, type SessionState } from '@/state/sessions';
import { useSettings } from '@/state/settings';
import type { DesktopBridge, KeepAwakeRequest } from '@/desktop/bridge';
import { keepAwakeTeller, keepAwakeWanted, startKeepAwake, type KeepAwakeSettings } from '@/state/keep-awake';

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

const settings = (keepAwake: KeepAwakeSettings['keepAwake'], patch: Partial<KeepAwakeSettings> = {}): KeepAwakeSettings => ({
    keepAwake,
    keepAwakeOnBattery: false,
    keepAwakeDisplay: false,
    ...patch
});

const SYSTEM: KeepAwakeRequest = { onBattery: false, display: false };

describe('what to ask the shell for', () => {
    const busy = { 'local:t1': session(agent('running')) };
    const settled = { 'local:t1': session(agent('idle')) };

    test('nothing while the setting is off', () => {
        expect(keepAwakeWanted(settings('off'), busy, { 'local:c1': chat('running') })).toBeNull();
    });

    test('the system the moment an agent works, and nothing once the last one settles', () => {
        expect(keepAwakeWanted(settings('working'), busy, {})).toEqual(SYSTEM);
        expect(keepAwakeWanted(settings('working'), settled, {})).toBeNull();
    });

    test('always means with or without an agent', () => {
        expect(keepAwakeWanted(settings('always'), settled, {})).toEqual(SYSTEM);
    });

    test('battery rides along as asked, so the shell can weigh it against the power source', () => {
        expect(keepAwakeWanted(settings('always', { keepAwakeOnBattery: true }), {}, {})).toEqual({ onBattery: true, display: false });
    });

    test('the display only for always, even when the switch was left on', () => {
        expect(keepAwakeWanted(settings('always', { keepAwakeDisplay: true }), {}, {})).toEqual({ onBattery: false, display: true });
        expect(keepAwakeWanted(settings('working', { keepAwakeDisplay: true }), busy, {})).toEqual(SYSTEM);
    });
});

describe('how the shell is told', () => {
    const bridge = (patch: Partial<DesktopBridge>): DesktopBridge => ({ platform: 'darwin', ...patch }) as DesktopBridge;

    test('the request itself where the shell understands one', () => {
        const told: (KeepAwakeRequest | null)[] = [];
        keepAwakeTeller(bridge({ requestKeepAwake: (request) => told.push(request), setKeepAwake: () => undefined }))?.({ onBattery: true, display: true });
        expect(told).toEqual([{ onBattery: true, display: true }]);
    });

    test('the switch before it in an older shell', () => {
        const told: boolean[] = [];
        const tell = keepAwakeTeller(bridge({ setKeepAwake: (keep) => told.push(keep) }));
        tell?.(SYSTEM);
        tell?.(null);
        expect(told).toEqual([true, false]);
    });

    test('nobody off macOS or in a browser', () => {
        expect(keepAwakeTeller(bridge({ platform: 'linux', requestKeepAwake: () => undefined }))).toBeUndefined();
        expect(keepAwakeTeller(null)).toBeUndefined();
    });
});

describe('what the shell is told', () => {
    const working = (status: AgentStatus): void => {
        useSessions.setState({ byKey: { 'local:t1': session(agent(status)) } });
    };

    afterEach(() => {
        useSessions.setState({ byKey: {} });
        useChats.setState({ byKey: {} });
        useSettings.setState(settings('off', { keepAwakeDisplay: false, keepAwakeOnBattery: false }));
    });

    test('nothing at all in a browser, which has no shell to ask', () => {
        expect(startKeepAwake(undefined)).toBeNull();
    });

    test('the request when an agent starts and null when it settles', () => {
        const told: (KeepAwakeRequest | null)[] = [];
        const stop = startKeepAwake((request) => told.push(request));
        useSettings.setState({ keepAwake: 'working' });
        working('running');
        working('idle');
        stop?.();
        expect(told).toEqual([SYSTEM, null]);
    });

    test('once per change, not once per event the stores see', () => {
        const told: (KeepAwakeRequest | null)[] = [];
        const stop = startKeepAwake((request) => told.push(request));
        useSettings.setState({ keepAwake: 'working' });
        working('running');
        useChats.setState({ byKey: { 'local:c1': chat('running') } });
        working('running');
        stop?.();
        expect(told).toEqual([SYSTEM, null]);
    });

    test('the setting turned off mid-turn reaches the shell', () => {
        const told: (KeepAwakeRequest | null)[] = [];
        useSettings.setState({ keepAwake: 'working' });
        const stop = startKeepAwake((request) => told.push(request));
        working('running');
        useSettings.setState({ keepAwake: 'off' });
        stop?.();
        expect(told).toEqual([SYSTEM, null]);
    });

    test('always holds from the start, and a change of what it holds is told again', () => {
        const told: (KeepAwakeRequest | null)[] = [];
        useSettings.setState({ keepAwake: 'always' });
        const stop = startKeepAwake((request) => told.push(request));
        useSettings.setState({ keepAwakeDisplay: true });
        stop?.();
        expect(told).toEqual([SYSTEM, { onBattery: false, display: true }, null]);
    });

    test('the block goes with the watcher, so a teardown never leaves one behind', () => {
        const told: (KeepAwakeRequest | null)[] = [];
        useSettings.setState({ keepAwake: 'working' });
        const stop = startKeepAwake((request) => told.push(request));
        working('running');
        stop?.();
        expect(told).toEqual([SYSTEM, null]);
    });
});
