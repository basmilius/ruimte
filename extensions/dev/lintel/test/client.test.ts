import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createTestHost, createTestServer } from '@ruimte/extension/testing';
import type { LintelServer } from '../server';

describe('Lintel in the window', () => {
    test('covers its config files with a language of its own, by extension and by name, and gives them an icon', async () => {
        const host = await createTestHost();

        expect(host.languageOf('/project/rules.lintel')).toBe('lintel');
        expect(host.languageOf('/project/Lintelfile')).toBe('lintel');
        expect(host.languageOf('/project/src/app.ts')).toBeNull();
        expect(host.definitions.find((each) => each.kind === 'fileIcon')?.definition).toMatchObject({ extensions: ['lintel'], path: 'assets/lintel-file.svg' });
    });

    test('ships the grammar its language names, as a TextMate grammar of its own scope', async () => {
        const host = await createTestHost();
        const language = host.definitions.find((each) => each.kind === 'language')?.definition;
        const grammar = JSON.parse(readFileSync(join(import.meta.dir, '..', String(language?.grammar)), 'utf8')) as { scopeName: string; patterns: object[] };

        expect(grammar.scopeName).toBe('source.lintel');
        expect(grammar.patterns.length).toBeGreaterThan(0);
    });

    test('adds a language server for the language its client defines, when a person asks from the palette', async () => {
        const server = await createTestServer<LintelServer>();
        const host = await createTestHost({ answers: { server } });
        const command = host.definitions.find((each) => each.kind === 'command')?.definition as { run(): Promise<void> } | undefined;

        await command?.run();

        expect(server.languageServers).toEqual([{ name: 'Lintel config', command: 'cat', languages: ['lintel'], patterns: ['*.lintel', 'Lintelfile'] }]);
        expect(host.notifications).toEqual([{ text: 'Look in Settings, Language servers', tone: 'neutral' }]);
    });
});
