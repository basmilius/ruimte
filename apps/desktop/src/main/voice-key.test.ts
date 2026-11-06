import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { SecretStore } from '../secret-store';
import { MACHINE_STILL_HOLDS_KEY, pendingRemovalFile, voiceKey, type MachineVoiceKey, type PendingRemoval } from './voice-key';

interface FakeMachine extends MachineVoiceKey {
    copy: string | null;
    up: boolean;
}

function fakeMachine(): FakeMachine {
    const machine: FakeMachine = {
        copy: null,
        up: true,
        hand: async (key) => {
            if (machine.up) {
                machine.copy = key;
            }

            return machine.up;
        },
        clear: async () => {
            if (machine.up) {
                machine.copy = null;
            }

            return machine.up;
        }
    };

    return machine;
}

function memoryStore(): SecretStore {
    let secret: string | null = null;

    return {
        persistent: () => true,
        read: async () => secret,
        write: async (next) => {
            secret = next;
        }
    };
}

let folder: string;

beforeEach(async () => {
    folder = await mkdtemp(join(tmpdir(), 'ruimte-voice-key-'));
});

afterEach(async () => {
    await rm(folder, { recursive: true, force: true });
});

describe('removing the Voice key', () => {
    test('while the machine is away, the removal stays owed across a restart and lands once it runs', async () => {
        const machine = fakeMachine();
        const keys = memoryStore();
        const pendingPath = join(folder, 'openai-api-key-removal');
        const first = voiceKey(() => keys, pendingRemovalFile(pendingPath), machine);
        await first.save('sk-test');
        machine.up = false;

        await expect(first.remove()).rejects.toThrow(MACHINE_STILL_HOLDS_KEY);
        expect(await first.status()).toEqual({ configured: false, persistent: false, machineKeyLeft: true });

        const restarted = voiceKey(() => keys, pendingRemovalFile(pendingPath), machine);

        expect(await restarted.status()).toMatchObject({ machineKeyLeft: true });
        expect(machine.copy).toBe('sk-test');

        machine.up = true;
        await restarted.handOver();

        expect(machine.copy).toBeNull();
        expect(await restarted.status()).toEqual({ configured: false, persistent: false });
    });

    test('a key removed while the app runs without its machine is taken from the machine at the next local start', async () => {
        const machine = fakeMachine();
        const keys = memoryStore();
        const pendingPath = join(folder, 'openai-api-key-removal');
        await voiceKey(() => keys, pendingRemovalFile(pendingPath), machine).save('sk-test');

        expect(await voiceKey(() => keys, pendingRemovalFile(pendingPath), null).remove()).toEqual({ configured: false, persistent: false });

        await voiceKey(() => keys, pendingRemovalFile(pendingPath), machine).handOver();

        expect(machine.copy).toBeNull();
    });

    test('a slow removal from an earlier status never takes a key saved meanwhile', async () => {
        const machine = fakeMachine();
        const keys = memoryStore();
        let owed = false;
        const pending: PendingRemoval = {
            owed: async () => owed,
            set: async (next) => {
                owed = next;
            }
        };
        const voice = voiceKey(() => keys, pending, machine);
        await voice.save('sk-old');
        machine.up = false;
        await voice.remove().catch(() => undefined);
        machine.up = true;

        const clearing = Promise.withResolvers<void>();
        const slowClear = Promise.withResolvers<void>();
        const clear = machine.clear;
        machine.clear = async () => {
            clearing.resolve();
            await slowClear.promise;
            return clear();
        };

        const retry = voice.status();
        await clearing.promise;
        const saved = voice.save('sk-new');
        // Every fake answers in a microtask, so these turns let a save that does not wait finish first.
        for (let i = 0; i < 20; i++) {
            await Promise.resolve();
        }
        slowClear.resolve();
        await Promise.all([retry, saved]);

        expect(machine.copy).toBe('sk-new');
        expect(await voice.status()).toEqual({ configured: true, persistent: true });
    });

    test('a key saved while a removal is owed is what the machine holds next', async () => {
        const machine = fakeMachine();
        const keys = memoryStore();
        const voice = voiceKey(() => keys, pendingRemovalFile(join(folder, 'openai-api-key-removal')), machine);
        await voice.save('sk-old');
        machine.up = false;
        await voice.remove().catch(() => undefined);
        machine.up = true;
        await voice.save('sk-new');
        await voice.handOver();

        expect(machine.copy).toBe('sk-new');
        expect(await voice.status()).toEqual({ configured: true, persistent: true });
    });
});
