import { describe, expect, test } from 'bun:test';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const SOURCE = join(import.meta.dir, '..');
const SENT = /ipcRenderer\.(?:invoke|send|sendSync)\(\s*'([^']+)'/g;
const REGISTERED = /\b(?:ipc|ipcMain)\.(?:handle|on|once)\(\s*'([^']+)'/g;

function channels(text: string, pattern: RegExp): string[] {
    return [...text.matchAll(pattern)].map((match) => match[1] as string);
}

function mainSources(): string[] {
    return readdirSync(SOURCE, { recursive: true, encoding: 'utf8' })
        .filter((path) => path.endsWith('.ts') && !path.endsWith('.test.ts'))
        .filter((path) => path !== 'preload.ts' && path !== 'guest.ts')
        .map((path) => readFileSync(join(SOURCE, path), 'utf8'));
}

describe('the channels of the main process', () => {
    test('every channel the preload sends on has a handler in the main process', () => {
        const sent = new Set(channels(readFileSync(join(SOURCE, 'preload.ts'), 'utf8'), SENT));
        const registered = new Set(mainSources().flatMap((text) => channels(text, REGISTERED)));

        expect(sent.size).toBeGreaterThan(50);
        expect([...sent].filter((channel) => !registered.has(channel))).toEqual([]);
    });

    test('main.ts installs no channel itself, only through the modules in src/main', () => {
        expect(channels(readFileSync(join(SOURCE, 'main.ts'), 'utf8'), REGISTERED)).toEqual([]);
    });
});
