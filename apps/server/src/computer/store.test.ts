import { describe, expect, test } from 'bun:test';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tempHome } from './computer-test-helpers.ts';
import { ComputerUseStore } from './store.ts';

const grantsFile = async (home: string): Promise<unknown> => JSON.parse(await readFile(join(home, 'computer-use', 'grants.json'), 'utf8'));

describe('taking a grant back', () => {
    test('"always" goes from the file, and only for that app', async () => {
        const home = await tempHome();
        let now = 10;
        const store = new ComputerUseStore(home, () => now);
        await store.allowAlways('com.example.textedit', 'TextEdit');
        now = 20;
        await store.allowAlways('com.example.notes', 'Notes');

        expect(await store.revokeAlways('com.example.textedit')).toBe(true);
        expect(store.alwaysAllowed('com.example.textedit')).toBe(false);
        expect(store.lasting().always).toEqual([{ bundleId: 'com.example.notes', name: 'Notes', at: 20 }]);
        expect(await grantsFile(home)).toEqual({ always: [{ bundleId: 'com.example.notes', name: 'Notes', at: 20 }], terminals: [] });
        expect(await store.revokeAlways('com.example.textedit')).toBe(false);
    });

    test('a terminal is forgotten, and a restart reads it that way', async () => {
        const home = await tempHome();
        const store = new ComputerUseStore(home, () => 5);
        await store.rememberTerminal('com.example.shells', 'Shells');
        await store.allowAlways('com.example.shells', 'Shells');

        expect(await store.forgetTerminal('com.example.shells')).toBe(true);
        expect(store.knownTerminal('com.example.shells')).toBe(false);
        expect(await store.forgetTerminal('com.example.shells')).toBe(false);

        const restarted = new ComputerUseStore(home);
        await restarted.load();
        expect(restarted.lasting()).toEqual({ always: [{ bundleId: 'com.example.shells', name: 'Shells', at: 5 }], terminals: [] });
    });
});
