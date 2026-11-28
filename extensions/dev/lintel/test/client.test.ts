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

    test('marks the lines its rules find something on in the margin of an open file, and again after a save', async () => {
        const server = await createTestServer<LintelServer>({
            files: { 'src/app.ts': ['export const port = 5173;', '// TODO: read the port', `const wide = '${'x'.repeat(120)}';`, ''].join('\n') }
        });
        const host = await createTestHost({ project: { id: 'project-1', folder: '/project' }, answers: { server } });

        server.fire('project.opened', { project: { id: 'project-1', name: 'Project', folder: '/project' } });

        const editor = host.openEditor('src/app.ts');
        const marks = (): object[] => editor.decorations().map(({ line, kind }) => ({ line, kind }));

        await settled(() => marks().length === 2);

        expect(editor.decorations()).toEqual([
            { decoration: 'problems', line: 2, endLine: 2, kind: 'info' },
            { decoration: 'problems', line: 3, endLine: 3, kind: 'warning' }
        ]);

        server.writeFile('src/app.ts', 'export const port = 5173;   \n');
        host.changeFile('src/app.ts');
        await settled(() => marks().length === 1);

        expect(marks()).toEqual([{ line: 1, kind: 'muted' }]);
        expect(await server.call('marks', '/project/logo.png')).toEqual({ ok: true, value: [] });
        expect(await server.call('marks', '/elsewhere/app.ts')).toEqual({ ok: true, value: [] });
    });

    test("checks the file a person works on from the editor's toolbar, its status bar and the menus of the editor and of the file", async () => {
        const server = await createTestServer<LintelServer>({ files: { 'src/app.ts': '// TODO: one\n// FIXME: two\n' } });
        const host = await createTestHost({ project: { id: 'project-1', folder: '/project' }, answers: { server } });
        const file = { path: '/project/src/app.ts', name: 'app.ts', extension: 'ts' };
        const check = host.action('check-file');

        server.fire('project.opened', { project: { id: 'project-1', name: 'Project', folder: '/project' } });

        expect(host.slot(check, 'editorToolbar', { file })?.title).toBe('Lintel: check this file');
        expect(host.slot(check, 'editorStatusBar', { file })?.title).toBe('Lintel: ts');
        expect(host.slot(check, 'editorMenu', { file, files: [file] })).not.toBeNull();
        expect(host.slot(check, 'fileMenu', { file, files: [file] })).not.toBeNull();
        expect(await host.run(check, 'editorToolbar', { file })).toEqual({ ok: true, value: undefined });
        expect(host.notifications).toEqual([{ text: 'Lintel found 2 in app.ts', tone: 'neutral' }]);
    });
});

/* Turns of the event loop until the editor has its answer, which comes from `server/` over several awaits. */
async function settled(check: () => boolean): Promise<void> {
    for (let turn = 0; turn < 200 && !check(); turn++) {
        await new Promise<void>((resolve) => setImmediate(resolve));
    }
}
