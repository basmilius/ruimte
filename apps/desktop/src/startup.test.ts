import { describe, expect, test } from 'bun:test';
import { createSecretGate, startApp, type StartupDeps } from './startup';

function settle(): Promise<void> {
    return new Promise((resolve) => setImmediate(resolve));
}

function setup(options: { smoke?: boolean; localMachine?: boolean } = {}) {
    const events: string[] = [];
    const machine = Promise.withResolvers<boolean>();
    const storage = Promise.withResolvers<() => void>();
    const deps: StartupDeps = {
        localMachine: options.localMachine ?? true,
        startMachine: () => {
            events.push('start machine');
            return machine.promise;
        },
        moveStorage: () => {
            events.push('move storage');
            return storage.promise;
        },
        restoreWindows: () => events.push('restore windows'),
        startUpdater: () => events.push('start updater'),
        machineReady: () => events.push('machine ready'),
        fail: (message) => events.push(`fail: ${message}`),
        quit: () => events.push('quit'),
        ...(options.smoke ? { smoke: async () => void events.push('smoke') } : {})
    };
    const run = startApp(deps);
    return { events, machine, storage, run };
}

describe('startApp', () => {
    test('the windows open before the machine answers, after the storage they read moved', async () => {
        const { events, machine, storage, run } = setup();
        await settle();
        expect(events).toEqual(['start machine', 'move storage']);
        storage.resolve(() => events.push('close storage move'));
        await settle();
        expect(events).toEqual(['start machine', 'move storage', 'restore windows', 'close storage move', 'start updater']);
        machine.resolve(true);
        await run;
        expect(events.at(-1)).toBe('machine ready');
    });

    test('a machine that does not come up is said and quits, and the secret is never handed out', async () => {
        const { events, machine, storage, run } = setup();
        storage.resolve(() => undefined);
        await settle();
        machine.reject(new Error('The background service did not come up'));
        await run;
        expect(events.slice(-2)).toEqual(['fail: The background service did not come up', 'quit']);
        expect(events).not.toContain('machine ready');
    });

    test('a person who chose to quit before the windows stood gets none', async () => {
        const { events, machine, storage, run } = setup();
        machine.resolve(false);
        await settle();
        storage.resolve(() => events.push('close storage move'));
        await run;
        expect(events).toEqual(['start machine', 'move storage', 'quit', 'close storage move']);
    });

    test('the smoke run opens its window once the machine is ready, and moves nothing', async () => {
        const { events, machine, run } = setup({ smoke: true });
        machine.resolve(true);
        await run;
        expect(events).toEqual(['start machine', 'machine ready', 'smoke', 'quit']);
    });

    test('the smoke run stops when the machine does not come up', async () => {
        const { events, machine, run } = setup({ smoke: true });
        machine.reject(new Error('missing'));
        await run;
        expect(events).toEqual(['start machine', 'fail: missing', 'quit']);
    });
});

describe('startApp without a machine', () => {
    test('moves the storage, restores the windows and starts the updater, and starts no machine', async () => {
        const { events, storage, run } = setup({ localMachine: false });
        storage.resolve(() => events.push('close storage move'));
        await run;
        expect(events).toEqual(['move storage', 'restore windows', 'close storage move', 'start updater']);
    });

    test('the smoke run runs its window and quits', async () => {
        const { events, run } = setup({ localMachine: false, smoke: true });
        await run;
        expect(events).toEqual(['smoke', 'quit']);
    });
});

describe('createSecretGate', () => {
    test('the secret is read only once the gate opened', async () => {
        let reads = 0;
        const gate = createSecretGate(async () => {
            reads++;
            return 'secret';
        });
        let answer: string | null | undefined;
        void gate.read().then((secret) => {
            answer = secret;
        });
        await settle();
        expect(answer).toBeUndefined();
        expect(reads).toBe(0);
        gate.open();
        await settle();
        expect(answer).toBe('secret');
        expect(await gate.read()).toBe('secret');
        expect(reads).toBe(2);
    });
});
