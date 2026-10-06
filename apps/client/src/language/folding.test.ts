import { describe, expect, test } from 'bun:test';
import { FakeEditorEngine } from '@adecore/editor/fake';
import { EditorLanguage } from './ruimte-editor-language';
import { FakeLanguageTransport } from './fake-daemon';

import { ProjectLanguage } from './ruimte-project-language';
import { ManualTimers } from '@adecore/editor-react/testing';

const range = (start: number, end: number) => ({ start: { line: start, character: 0 }, end: { line: end, character: 1 } });

async function settle(): Promise<void> {
    for (let turn = 0; turn < 100; turn++) {
        await Promise.resolve();
    }
}

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
