import { describe, expect, test } from 'bun:test';
import { FakeEditorEngine } from '@adecore/editor/fake';
import { EditorLanguage } from './ruimte-editor-language';
import { FakeLanguageTransport } from './fake-daemon';
import { ProjectLanguage } from './ruimte-project-language';

const uri = 'file:///work/app/src/a.ts';
const at = (line: number, character: number) => ({ line, character });
const range = (line: number, start: number, end: number) => ({ start: at(line, start), end: at(line, end) });

describe('selection ranges', () => {
    async function setup(providers: Record<string, unknown>) {
        const transport = new FakeLanguageTransport();
        transport.providers = providers;
        const asked: unknown[] = [];
        transport.answers.set('language.request', (payload) => {
            asked.push(payload);
            return {
                result: [{ range: range(0, 4, 9), parent: { range: range(0, 0, 14), parent: { range: range(0, 0, 20) } } }],
                server: 'typescript',
                version: 1
            };
        });
        const project = new ProjectLanguage(transport, 'p1', '/work/app');
        const editor = new FakeEditorEngine().mount({} as HTMLElement, { text: 'let value = 1;\nnext', theme: 'light' });
        const language = new EditorLanguage(project, editor, uri, 'typescript');
        await language.document.ready;
        return { editor, language, asked };
    }

    test('hands the editor the chain of each position when a server offers them', async () => {
        const { editor, asked } = await setup({ 'textDocument/selectionRange': {} });
        expect(await editor.selectionRanges?.([at(0, 5)])).toEqual([[range(0, 4, 9), range(0, 0, 14), range(0, 0, 20)]]);
        expect(asked).toMatchObject([{ method: 'textDocument/selectionRange', params: { positions: [at(0, 5)] } }]);
    });

    test('has the editor use its own rule when no server offers them, and when the document goes', async () => {
        const { editor, language, asked } = await setup({});
        expect(await editor.selectionRanges?.([at(0, 5)])).toBeNull();
        expect(asked).toEqual([]);
        language.dispose();
        expect(editor.selectionRanges).toBeNull();
    });
});
