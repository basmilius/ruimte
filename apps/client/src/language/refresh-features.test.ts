import { describe, expect, test } from 'bun:test';
import { FakeEditorEngine } from '@adecore/editor/fake';
import { EditorLanguage } from './ruimte-editor-language';
import { FakeLanguageTransport } from './fake-daemon';
import { editorHintsOf } from './inlay-hints';
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
    });
});

describe('editorHintsOf', () => {
    test('orders hints by position and drops an empty one', () => {
        expect(
            editorHintsOf([
                { position: { line: 2, character: 0 }, label: 'b:' },
                { position: { line: 1, character: 4 }, label: '' },
                { position: { line: 0, character: 9 }, label: ': string' }
            ])
        ).toEqual([
            { position: { line: 0, character: 9 }, label: ': string' },
            { position: { line: 2, character: 0 }, label: 'b:' }
        ]);
    });
});
