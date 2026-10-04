import { describe, expect, test } from 'bun:test';
import { FakeEditorEngine } from '@ruimte/smart-editor/fake';
import { EditorLanguage } from './editor-language';
import { FakeLanguageTransport } from './fake-daemon';
import { ProjectLanguage } from './project-language';
import { blocksOf } from './symbols';
import { ManualTimers } from './timers';

const range = (start: number, end: number) => ({ start: { line: start, character: 0 }, end: { line: end, character: 1 } });

describe('blocksOf', () => {
    test('flattens the tree, keeps the multi-line symbols that have a body, and counts lines from one', () => {
        const blocks = blocksOf([
            {
                name: 'Matcher',
                kind: 5,
                range: range(0, 20),
                selectionRange: range(0, 0),
                children: [
                    { name: 'score', kind: 6, range: range(2, 9), selectionRange: range(2, 2) },
                    { name: 'weights', kind: 7, range: range(10, 14), selectionRange: range(10, 10) },
                    { name: 'one', kind: 6, range: range(15, 15), selectionRange: range(15, 15) }
                ]
            },
            { name: 'rank', kind: 12, range: range(22, 30), selectionRange: range(22, 22) }
        ]);
        expect(blocks).toEqual([
            { startLine: 1, endLine: 21, name: 'Matcher', kind: 'class' },
            { startLine: 3, endLine: 10, name: 'score', kind: 'method' },
            { startLine: 23, endLine: 31, name: 'rank', kind: 'function' }
        ]);
    });

    test('reads a flat list of symbols, and nothing for none', () => {
        expect(blocksOf([{ name: 'f', kind: 12, location: { uri: 'file:///a.php', range: range(1, 4) } }])).toEqual([
            { startLine: 2, endLine: 5, name: 'f', kind: 'function' }
        ]);
        expect(blocksOf(null)).toEqual([]);
        expect(blocksOf([])).toEqual([]);
    });
});

describe('symbols feature', () => {
    test('hands the editor the blocks the server names, and again after an edit', async () => {
        const transport = new FakeLanguageTransport();
        transport.providers = { 'textDocument/documentSymbol': {} };
        let name = 'first';
        transport.answers.set('language.request', () => ({
            result: [{ name, kind: 12, range: range(0, 3), selectionRange: range(0, 0) }],
            server: 'typescript',
            version: 1
        }));
        const timers = new ManualTimers();
        const project = new ProjectLanguage(transport, 'p1', '/work/app');
        const editor = new FakeEditorEngine().mount({} as HTMLElement, { text: 'function a() {\n}\n', theme: 'light' });
        const language = new EditorLanguage(project, editor, 'file:///work/app/src/a.ts', 'typescript', timers);
        await language.document.ready;
        for (let turn = 0; turn < 100; turn++) {
            await Promise.resolve();
        }
        expect(editor.blocks).toEqual([{ startLine: 1, endLine: 4, name: 'first', kind: 'function' }]);
        name = 'second';
        editor.type('function a() {\n}\n// x');
        timers.advance(600);
        for (let turn = 0; turn < 100; turn++) {
            await Promise.resolve();
        }
        expect(editor.blocks?.[0]?.name).toBe('second');
    });
});
