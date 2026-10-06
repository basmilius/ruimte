import { describe, expect, test } from 'bun:test';
import { FakeEditorEngine } from '@adecore/editor/fake';
import { ManualTimers } from '@adecore/editor-react/testing';
import { EditorLanguage } from './ruimte-editor-language';
import { FakeLanguageTransport } from './fake-daemon';

import { ProjectLanguage } from './ruimte-project-language';

const uri = 'file:///work/app/src/a.ts';

async function settle(): Promise<void> {
    for (let turn = 0; turn < 30; turn++) {
        await Promise.resolve();
    }
}

describe('inlay hints and semantic tokens', () => {
    test('are asked for once the document is open and a server offers them, and drawn', async () => {
        const transport = new FakeLanguageTransport();
        const calls: string[] = [];
        transport.answers.set('language.request', (payload: { method: string }) => {
            calls.push(payload.method);
            const result =
                payload.method === 'textDocument/inlayHint'
                    ? [{ position: { line: 0, character: 5 }, label: [{ value: ': ' }, { value: 'number' }] }]
                    : { data: [0, 10, 4, 0, 0] };
            return { result, server: 'typescript', version: 1 };
        });
        transport.providers = {
            'textDocument/inlayHint': {},
            'textDocument/semanticTokens/full': { legend: { tokenTypes: ['function'], tokenModifiers: [] }, full: true }
        };
        const project = new ProjectLanguage(transport, 'p1', '/work/app');
        const editor = new FakeEditorEngine().mount({} as HTMLElement, { text: 'let a = call();', theme: 'light' });
        const language = new EditorLanguage(project, editor, uri, 'typescript');
        await language.document.ready;
        await settle();
        expect(calls.sort()).toEqual(['textDocument/inlayHint', 'textDocument/semanticTokens/full']);
        expect(editor.inlayHints).toEqual([{ position: { line: 0, character: 5 }, label: ': number' }]);
        expect(editor.semanticTokens).toEqual([{ line: 0, character: 10, length: 4, scopes: ['entity.name.function.call'] }]);
        transport.emit('language.providers', { projectId: 'p1', path: 'src/a.ts', providers: transport.providers });
        await settle();
        expect(calls.filter((method) => method === 'textDocument/inlayHint')).toHaveLength(2);
        expect(calls.filter((method) => method === 'textDocument/semanticTokens/full')).toHaveLength(2);
        language.dispose();
        project.dispose();
    });
});

test('opens every offered feature once, including code vision, after the document is ready', async () => {
    const transport = new FakeLanguageTransport();
    transport.providers = {
        'textDocument/documentSymbol': {},
        'textDocument/foldingRange': {},
        'textDocument/inlayHint': {},
        'textDocument/semanticTokens/full': { legend: { tokenTypes: [], tokenModifiers: [] }, full: true },
        'textDocument/codeAction': {},
        'textDocument/references': {}
    };
    const calls: string[] = [];
    transport.answers.set('language.request', (payload: { method: string }) => {
        calls.push(payload.method);
        const result =
            payload.method === 'textDocument/documentSymbol'
                ? [
                      {
                          name: 'score',
                          kind: 12,
                          range: { start: { line: 0, character: 0 }, end: { line: 2, character: 1 } },
                          selectionRange: { start: { line: 0, character: 9 }, end: { line: 0, character: 14 } }
                      }
                  ]
                : payload.method === 'textDocument/semanticTokens/full'
                  ? { data: [] }
                  : [];
        return { result, server: 'typescript', version: 1 };
    });
    const project = new ProjectLanguage(transport, 'p1', '/work/app');
    transport.holdNextReply();
    const editor = new FakeEditorEngine().mount({} as HTMLElement, { text: 'function score() {\n    return 1;\n}', theme: 'light' });
    const timers = new ManualTimers();
    const language = new EditorLanguage(project, editor, uri, 'typescript', timers);
    try {
        language.codeVision.configure({ usages: true, authors: false });
        await settle();
        timers.advance(1000);
        await settle();
        expect(calls).toEqual([]);
        transport.release();
        await language.document.ready;
        await settle();
        timers.advance(1000);
        await settle();
        expect(calls.sort()).toEqual(Object.keys(transport.providers).sort());
        expect(editor.codeVision[0]?.entries[0]?.text).toBe('No usages');
    } finally {
        language.dispose();
        project.dispose();
    }
});
