import { describe, expect, test } from 'bun:test';
import { FakeEditorEngine } from '@adecore/editor/fake';
import { EditorLanguage } from './ruimte-editor-language';
import { FakeLanguageTransport } from './fake-daemon';
import { ProjectLanguage } from './ruimte-project-language';

import { ManualTimers } from '@adecore/editor-react/testing';

const range = (start: number, end: number) => ({ start: { line: start, character: 0 }, end: { line: end, character: 1 } });

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
