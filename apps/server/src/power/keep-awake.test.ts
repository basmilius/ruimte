import { describe, expect, test } from 'bun:test';
import type { AgentInfo } from '@ruimte/contracts';
import { KeepAwake, agentsWorking, keepAwakeCommand, type HeldProcess, type KeepAwakeSetting, type KeepAwakeWork } from './keep-awake.ts';

const setting = (patch: Partial<KeepAwakeSetting> = {}): KeepAwakeSetting => ({ mode: 'always', onBattery: false, display: false, ...patch });

const agent = (status: AgentInfo['status'], live = true): AgentInfo => ({ kind: 'claude', status, live }) as AgentInfo;

const idle: KeepAwakeWork = { sessions: [], chats: [] };

describe('agentsWorking', () => {
    test('a terminal agent counts only while it is live and running', () => {
        expect(agentsWorking({ sessions: [{ exited: false, agent: agent('running') }], chats: [] })).toBe(true);
        expect(agentsWorking({ sessions: [{ exited: false, agent: agent('running', false) }], chats: [] })).toBe(false);
        expect(agentsWorking({ sessions: [{ exited: false, agent: agent('needs-you') }], chats: [] })).toBe(false);
        expect(agentsWorking({ sessions: [{ exited: true, agent: agent('running') }], chats: [] })).toBe(false);
    });

    test('a chat counts in a turn and between turns while its subagents work', () => {
        expect(agentsWorking({ sessions: [], chats: [{ status: 'running' }] })).toBe(true);
        expect(agentsWorking({ sessions: [], chats: [{ status: 'idle', delegating: true }] })).toBe(true);
        expect(agentsWorking({ sessions: [], chats: [{ status: 'needs-you', delegating: true }] })).toBe(false);
        expect(agentsWorking(idle)).toBe(false);
    });
});

describe('keepAwakeCommand', () => {
    test('holds on the adapter only unless battery is allowed, tied to the daemon', () => {
        expect(keepAwakeCommand(setting(), false, 'darwin', 42)).toEqual(['caffeinate', '-w', '42', '-s']);
        expect(keepAwakeCommand(setting({ onBattery: true }), false, 'darwin', 42)).toEqual(['caffeinate', '-w', '42', '-i']);
    });

    test('working holds only while an agent works', () => {
        expect(keepAwakeCommand(setting({ mode: 'working' }), false, 'darwin', 1)).toBeNull();
        expect(keepAwakeCommand(setting({ mode: 'working' }), true, 'darwin', 1)).toEqual(['caffeinate', '-w', '1', '-s']);
    });

    test('the display only under always, and never where it would hold on battery against the setting', () => {
        expect(keepAwakeCommand(setting({ display: true, onBattery: true }), false, 'darwin', 1)).toEqual(['caffeinate', '-w', '1', '-i', '-d']);
        expect(keepAwakeCommand(setting({ display: true }), false, 'darwin', 1)).toEqual(['caffeinate', '-w', '1', '-s']);
        expect(keepAwakeCommand(setting({ mode: 'working', display: true, onBattery: true }), true, 'darwin', 1)).toEqual(['caffeinate', '-w', '1', '-i']);
    });

    test('off, and anywhere but macOS, holds nothing', () => {
        expect(keepAwakeCommand(setting({ mode: 'off' }), true, 'darwin', 1)).toBeNull();
        expect(keepAwakeCommand(setting(), true, 'linux', 1)).toBeNull();
    });
});

/* Processes that never run: each records its command and resolves `exited` when it is killed or ends by itself. */
const fakeSpawner = () => {
    const started: { command: string[]; killed: boolean; end(): void }[] = [];
    const spawn = (command: string[]): HeldProcess => {
        let end = (): void => undefined;
        const exited = new Promise<void>((resolve) => {
            end = resolve;
        });
        const entry = { command, killed: false, end };
        started.push(entry);
        return {
            exited,
            kill() {
                entry.killed = true;
                end();
            }
        };
    };
    return { started, spawn };
};

describe('KeepAwake', () => {
    const holder = (state: { setting: KeepAwakeSetting; work: KeepAwakeWork }, spawn: (command: string[]) => HeldProcess) =>
        new KeepAwake({ platform: 'darwin', pid: 7, setting: () => state.setting, work: () => state.work, spawn, log: () => undefined });

    test('starts once, follows the work and lets go when it ends', () => {
        const fake = fakeSpawner();
        const state = { setting: setting({ mode: 'working' }), work: idle };
        const keepAwake = holder(state, fake.spawn);
        keepAwake.check();
        expect(fake.started).toHaveLength(0);
        state.work = { sessions: [], chats: [{ status: 'running' }] };
        keepAwake.check();
        keepAwake.check();
        expect(fake.started.map((entry) => entry.command)).toEqual([['caffeinate', '-w', '7', '-s']]);
        expect(keepAwake.holding).toBe(true);
        state.work = idle;
        keepAwake.check();
        expect(fake.started[0]?.killed).toBe(true);
        expect(keepAwake.holding).toBe(false);
    });

    test('a changed setting starts the new block before the old one goes', () => {
        const fake = fakeSpawner();
        const state = { setting: setting(), work: idle };
        const keepAwake = holder(state, fake.spawn);
        keepAwake.check();
        state.setting = setting({ onBattery: true });
        keepAwake.check();
        expect(fake.started.map((entry) => [entry.command.at(-1), entry.killed])).toEqual([
            ['-s', true],
            ['-i', false]
        ]);
    });

    test('a block that ended by itself is started again at the next check', async () => {
        const fake = fakeSpawner();
        const state = { setting: setting(), work: idle };
        const keepAwake = holder(state, fake.spawn);
        keepAwake.check();
        fake.started[0]?.end();
        // The `exited` handler runs a microtask later.
        await Promise.resolve();
        await Promise.resolve();
        expect(keepAwake.holding).toBe(false);
        keepAwake.check();
        expect(fake.started).toHaveLength(2);
    });

    test('a spawn that throws holds nothing, and stop lets go for good', () => {
        const fake = fakeSpawner();
        const state = { setting: setting(), work: idle };
        const failing = holder(state, () => {
            throw new Error('no caffeinate');
        });
        failing.check();
        expect(failing.holding).toBe(false);
        const keepAwake = holder(state, fake.spawn);
        keepAwake.check();
        keepAwake.stop();
        keepAwake.check();
        expect(fake.started).toHaveLength(1);
        expect(fake.started[0]?.killed).toBe(true);
    });
});
