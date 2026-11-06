import { describe, expect, test } from 'bun:test';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { IPC_EVENT, IPC_INVOKE, IPC_SEND } from '@ruimte/desktop-bridge/ipc';

const SOURCE = join(import.meta.dir, '..');
const PRELOAD = readFileSync(join(SOURCE, 'preload.ts'), 'utf8');
const TABLE = readFileSync(join(SOURCE, '../../../packages/desktop-bridge/src/ipc.ts'), 'utf8');

function channels(text: string, pattern: RegExp): string[] {
    return [...text.matchAll(pattern)].map((match) => match[1] as string);
}

function mainSources(): string[] {
    return readdirSync(SOURCE, { recursive: true, encoding: 'utf8' })
        .filter((path) => path.endsWith('.ts') && !path.endsWith('.test.ts'))
        .filter((path) => path !== 'preload.ts' && path !== 'guest.ts')
        .map((path) => readFileSync(join(SOURCE, path), 'utf8'));
}

function sorted(names: Iterable<string>): string[] {
    return [...new Set(names)].sort();
}

const MAIN = mainSources();

describe('the channel table of @ruimte/desktop-bridge/ipc', () => {
    test('has a handler in the main process for every invoke channel and none for another', () => {
        const registered = MAIN.flatMap((text) => channels(text, /\b(?:ipc|ipcMain)\.handle\(\s*'([^']+)'/g));

        expect(Object.keys(IPC_INVOKE).length).toBeGreaterThan(50);
        expect(sorted(registered)).toEqual(sorted(Object.keys(IPC_INVOKE)));
    });

    test('has a listener in the main process for every send channel and none for another', () => {
        const registered = MAIN.flatMap((text) => channels(text, /\b(?:ipc|ipcMain)\.(?:on|once)\(\s*'([^']+)'/g));

        expect(sorted(registered)).toEqual(sorted(Object.keys(IPC_SEND)));
    });

    test('is what the preload calls, by kind', () => {
        expect(sorted(channels(PRELOAD, /\binvoke\(\s*'([^']+)'/g))).toEqual(sorted(Object.keys(IPC_INVOKE)));
        expect(sorted(channels(PRELOAD, /\bsend\(\s*'([^']+)'/g))).toEqual(sorted(Object.keys(IPC_SEND)));
        expect(sorted(channels(PRELOAD, /\bon\(\s*'([^']+)'/g))).toEqual(sorted(Object.keys(IPC_EVENT)));
    });

    test('names every event channel in the main process, which sends it', () => {
        const text = MAIN.join('\n');
        const sentByTheShell = ['menu:run'];

        expect(Object.keys(IPC_EVENT).filter((channel) => !sentByTheShell.includes(channel) && !text.includes(`'${channel}'`))).toEqual([]);
    });

    test('keeps a channel name in one kind per direction', () => {
        expect(Object.keys(IPC_INVOKE).filter((channel) => channel in IPC_SEND)).toEqual([]);
    });

    test('entry.ts installs no channel itself, only through the modules in src/main', () => {
        expect(channels(readFileSync(join(SOURCE, 'entry.ts'), 'utf8'), /\b(?:ipc|ipcMain)\.(?:handle|on|once)\(\s*'([^']+)'/g)).toEqual([]);
    });
});

describe('what the preload bundles', () => {
    test('is the table with its types and nothing of the main process', () => {
        const imports = (text: string) =>
            [...text.matchAll(/^import (type )?[^;]*? from '([^']+)'/gm)].map((match) => ({ type: match[1] !== undefined, from: match[2] }));

        expect(imports(TABLE).filter((entry) => !entry.type)).toEqual([]);
        expect(
            imports(PRELOAD)
                .filter((entry) => !entry.type)
                .map((entry) => entry.from)
        ).toEqual(['@adecore/shell/bridge', './machine-argument']);
    });
});
