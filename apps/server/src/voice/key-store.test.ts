import { afterEach, beforeEach, describe, expect, spyOn, test } from 'bun:test';
import { mkdir, mkdtemp, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runVoice, type VoiceCliOptions } from '../cli/voice.ts';
import { MachineHome } from '../fs/machine-home.ts';
import { VoiceKeyStore } from './key-store.ts';

// Recognizable, so a test can prove it never lands in a line it should not.
const KEY = 'sk-test-voice-0123456789abcdef';

let root: string;
let home: string;
let store: VoiceKeyStore;

beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'ruimte-voice-key-'));
    home = join(root, 'home');
    store = new VoiceKeyStore(home);
});

afterEach(async () => {
    await rm(root, { recursive: true, force: true });
});

describe('VoiceKeyStore', () => {
    test('writes one 0600 file in a 0700 folder, replaced whole', async () => {
        await store.write(KEY);
        await store.write(` ${KEY}-second\n`);
        if (process.platform !== 'win32') {
            expect((await stat(store.path)).mode & 0o777).toBe(0o600);
            expect((await stat(join(home, 'voice'))).mode & 0o777).toBe(0o700);
        }
        expect(await readdir(join(home, 'voice'))).toEqual(['openai.json']);
        expect(await store.read()).toBe(`${KEY}-second`);
        expect(await store.has()).toBe(true);
    });

    test('clearing removes the file and says whether there was a key', async () => {
        expect(await store.clear()).toBe(false);
        await store.write(KEY);
        expect(await store.clear()).toBe(true);
        expect(await store.has()).toBe(false);
        expect(await store.read()).toBeNull();
    });

    test('refuses what is no key without naming it', async () => {
        await expect(store.write('')).rejects.toThrow('The key is empty');
        await expect(store.write(`${KEY} ${KEY}`)).rejects.toThrow('space or a line break');
        await expect(store.write('x'.repeat(2000))).rejects.toThrow('longer than');
        expect(await store.has()).toBe(false);
    });

    test('an unreadable file counts as no key and its text is never logged', async () => {
        await mkdir(join(home, 'voice'), { recursive: true });
        await writeFile(store.path, `{"key": ${KEY}`);
        const warn = spyOn(console, 'warn').mockImplementation(() => undefined);
        try {
            expect(await store.read()).toBeNull();
            expect(warn).toHaveBeenCalled();
            expect(JSON.stringify(warn.mock.calls)).not.toContain(KEY);
        } finally {
            warn.mockRestore();
        }
    });

    test('the folder is the machine state no client file request reaches', async () => {
        await store.write(KEY);
        const machine = new MachineHome(home);
        await expect(machine.refuse(store.path)).rejects.toMatchObject({ code: 'machine-state' });
        await expect(machine.refuse(join(home, 'voice'))).rejects.toMatchObject({ code: 'machine-state' });
    });
});

describe('ruimte voice key', () => {
    function options(args: string[], typed = KEY): VoiceCliOptions & { lines: string[]; asked: boolean[] } {
        const lines: string[] = [];
        const asked: boolean[] = [];
        return {
            args,
            home,
            interactive: true,
            readKey: async (interactive) => {
                asked.push(interactive);
                return typed;
            },
            out: (line) => lines.push(line),
            err: (line) => lines.push(line),
            lines,
            asked
        };
    }

    test('set asks for the key, saves it and never prints it', async () => {
        const run = options(['key', 'set'], `${KEY}\n`);
        expect(await runVoice(run)).toBe(0);
        expect(run.asked).toEqual([true]);
        expect(await store.read()).toBe(KEY);
        expect(run.lines.join('\n')).not.toContain(KEY);
    });

    test('status and clear say whether a key is there and nothing more', async () => {
        const before = options(['key', 'status']);
        expect(await runVoice(before)).toBe(0);
        expect(before.lines).toEqual([`No Voice key is set in ${home}.`]);
        await store.write(KEY);
        const after = options(['key', 'status']);
        expect(await runVoice(after)).toBe(0);
        expect(after.lines).toEqual([`A Voice key is set in ${home}.`]);
        const clear = options(['key', 'clear']);
        expect(await runVoice(clear)).toBe(0);
        expect(await store.has()).toBe(false);
        expect([...before.lines, ...after.lines, ...clear.lines].join('\n')).not.toContain(KEY);
    });

    test('saves the key in the home an installed Ruimte uses as well', async () => {
        const installed = join(root, '.ruimte');
        const run = { ...options(['key', 'set']), home: installed };
        expect(await runVoice(run)).toBe(0);
        expect(await new VoiceKeyStore(installed).read()).toBe(KEY);
    });

    test('an empty answer saves nothing', async () => {
        const run = options(['key', 'set'], '\n');
        expect(await runVoice(run)).toBe(1);
        expect(await store.has()).toBe(false);
    });

    test('a key as an argument is refused before anything is read', async () => {
        const run = options(['key', 'set', KEY]);
        expect(await runVoice(run)).toBe(2);
        expect(run.asked).toEqual([]);
        expect(run.lines.join('\n')).not.toContain(KEY);
        expect(await store.has()).toBe(false);
    });
});
