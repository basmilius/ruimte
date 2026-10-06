import { describe, expect, test } from 'bun:test';
import { FakeEditorEngine } from '@adecore/editor/fake';
import { EditorLanguage } from './ruimte-editor-language';
import { FakeLanguageTransport } from './fake-daemon';
import { foldRangesOf, foldSymbolsOf } from './folding';
import { ProjectLanguage } from './ruimte-project-language';
import { ManualTimers } from './timers';

const range = (start: number, end: number) => ({ start: { line: start, character: 0 }, end: { line: end, character: 1 } });

async function settle(): Promise<void> {
    for (let turn = 0; turn < 100; turn++) {
        await Promise.resolve();
    }
}

describe('foldSymbolsOf', () => {
    test('keeps the symbols that have a body of several lines, with the kind of body', () => {
        expect(
            foldSymbolsOf([
                {
                    name: 'Matcher',
                    kind: 5,
                    range: range(0, 20),
                    selectionRange: range(0, 0),
                    children: [
                        { name: 'score', kind: 6, range: range(2, 9), selectionRange: range(2, 2) },
                        { name: 'weights', kind: 7, range: range(10, 14), selectionRange: range(10, 10) },
                        { name: 'one', kind: 6, range: range(15, 15), selectionRange: range(15, 15) },
                        { name: 'Namespace', kind: 3, range: range(16, 19), selectionRange: range(16, 16) }
                    ]
                },
                { name: 'rank', kind: 12, range: range(22, 30), selectionRange: range(22, 22) }
            ])
        ).toEqual([
            { range: range(0, 20), body: 'class' },
            { range: range(2, 9), body: 'method' },
            { range: range(10, 14), body: 'value' },
            { range: range(22, 30), body: 'function' }
        ]);
    });

    test('reads a flat list, and nothing for none', () => {
        expect(foldSymbolsOf([{ name: 'f', kind: 12, location: { uri: 'file:///a.php', range: range(1, 4) } }])).toEqual([
            { range: range(1, 4), body: 'function' }
        ]);
        expect(foldSymbolsOf(null)).toEqual([]);
        expect(foldSymbolsOf([])).toEqual([]);
    });
});

describe('foldRangesOf', () => {
    test('keeps the ranges of more than one line, with their kind', () => {
        expect(
            foldRangesOf([
                { startLine: 1, endLine: 1 },
                { startLine: 2, endLine: 5, kind: 'imports' },
                { startLine: 6, endLine: 9 }
            ])
        ).toEqual([
            { startLine: 2, endLine: 5, kind: 'imports' },
            { startLine: 6, endLine: 9 }
        ]);
        expect(foldRangesOf(null)).toEqual([]);
    });
});

describe('folding feature', () => {
    test('hands the editor the symbols and the ranges the servers name, and again after an edit', async () => {
        const transport = new FakeLanguageTransport();
        transport.providers = { 'textDocument/documentSymbol': {}, 'textDocument/foldingRange': {} };
        let endLine = 3;
        transport.answers.set('language.request', (payload: { method: string }) => ({
            result:
                payload.method === 'textDocument/foldingRange'
                    ? [{ startLine: 0, endLine }]
                    : [{ name: 'a', kind: 12, range: range(0, 3), selectionRange: range(0, 0) }],
            server: 'typescript',
            version: 1
        }));
        const timers = new ManualTimers();
        const project = new ProjectLanguage(transport, 'p1', '/work/app');
        const editor = new FakeEditorEngine().mount({} as HTMLElement, { text: 'function a() {\n}\n', theme: 'light' });
        const language = new EditorLanguage(project, editor, 'file:///work/app/src/a.ts', 'typescript', timers);
        await language.document.ready;
        await settle();
        expect(editor.foldHints).toEqual({ symbols: [{ range: range(0, 3), body: 'function' }], ranges: [{ startLine: 0, endLine: 3 }] });
        endLine = 4;
        editor.type('function a() {\n}\n// x');
        timers.advance(600);
        await settle();
        expect(editor.foldHints?.ranges).toEqual([{ startLine: 0, endLine: 4 }]);
        language.dispose();
        expect(editor.foldHints).toBeNull();
    });
});
