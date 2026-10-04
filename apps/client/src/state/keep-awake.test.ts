import { afterEach, describe, expect, test } from 'bun:test';
import type { AgentInfo, AgentStatus } from '@ruimte/contracts';
import { useChats, type ChatState } from '@ruimte/agents-react/state/chats';
import { useSessions, type SessionState } from '@/state/sessions';
import { useSettings } from '@/state/settings';
import type { DesktopBridge, KeepAwakeRequest } from '@/desktop/bridge';
import { closedLidOf, keepAwakeChoice, keepAwakeTeller, keepAwakeToMove, keepAwakeWanted, startKeepAwake, type KeepAwakeSettings } from '@/state/keep-awake';
import { LOCAL_ENDPOINT_ID } from '@/state/endpoints';
import { serverInfoOf, useServers, type ServerInfo } from '@/state/server';

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

function chat(status: AgentStatus): ChatState {
    return {
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
    };
}

function settings(keepAwake: KeepAwakeSettings['keepAwake'], patch: Partial<KeepAwakeSettings> = {}): KeepAwakeSettings {
    return {
        keepAwake,
        keepAwakeOnBattery: false,
        keepAwakeDisplay: false,
        ...patch
    };
}

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
        useServers.setState({ byEndpoint: {} });
    });

    test("nothing from the shell once this computer's machine holds the block itself", () => {
        const told: (KeepAwakeRequest | null)[] = [];
        useSettings.setState({ keepAwake: 'always' });
        const stop = startKeepAwake((request) => told.push(request));
        useServers.setState({ byEndpoint: { [LOCAL_ENDPOINT_ID]: machine({ keepAwake: 'off' }) } });
        stop?.();
        expect(told).toEqual([SYSTEM, null]);
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

function machine(patch: Partial<ServerInfo>): ServerInfo {
    return { ...serverInfoOf('nobody'), keepAwakeAvailable: true, ...patch };
}

describe('where the setting is kept', () => {
    test('the machine once it holds keep awake, this client against a daemon from before', () => {
        const local = settings('working', { keepAwakeOnBattery: true });
        expect(keepAwakeChoice(machine({ keepAwake: 'always', keepAwakeDisplay: true }), local)).toEqual(settings('always', { keepAwakeDisplay: true }));
        expect(keepAwakeChoice(machine({ keepAwake: null }), local)).toEqual(local);
        expect(keepAwakeChoice(machine({ keepAwake: 'always', keepAwakeAvailable: false }), local)).toEqual(local);
    });
});

describe('moving the setting this client kept to its machine', () => {
    test('onto a machine still at its defaults, once', () => {
        const local = settings('working', { keepAwakeOnBattery: true });
        expect(keepAwakeToMove(machine({ keepAwake: 'off' }), local)).toEqual(local);
        expect(keepAwakeToMove(machine({ keepAwake: 'off' }), settings('off'))).toBeNull();
    });

    test('a machine someone already set keeps what it has, and this client only drops its own', () => {
        expect(keepAwakeToMove(machine({ keepAwake: 'always' }), settings('working'))).toEqual(settings('off'));
    });

    test('nothing moves to a daemon from before or one that cannot hold a block', () => {
        expect(keepAwakeToMove(machine({ keepAwake: null }), settings('working'))).toBeNull();
        expect(keepAwakeToMove(machine({ keepAwake: 'off', keepAwakeAvailable: false }), settings('working'))).toBeNull();
    });
});

describe('the closed lid', () => {
    test('offered only by a machine that holds keep awake and says it can keep its lid open', () => {
        expect(closedLidOf(machine({ keepAwake: 'working', keepAwakeLidAvailable: true }))).toEqual({ offered: true, rule: false, on: false });
        expect(closedLidOf(machine({ keepAwake: null, keepAwakeLidAvailable: true })).offered).toBe(false);
        expect(closedLidOf(machine({ keepAwake: 'working', keepAwakeLidAvailable: false })).offered).toBe(false);
        expect(closedLidOf(undefined)).toEqual({ offered: false, rule: false, on: false });
    });

    test('a switch left on reads as off while the rule is missing', () => {
        const info = machine({ keepAwake: 'always', keepAwakeLidAvailable: true, keepAwakeLidClosed: true });
        expect(closedLidOf(info).on).toBe(false);
        expect(closedLidOf({ ...info, keepAwakeLidRule: true })).toEqual({ offered: true, rule: true, on: true });
    });
});
