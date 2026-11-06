import { describe, expect, test } from 'bun:test';
import { FakeEditorEngine } from '@adecore/editor/fake';
import { FakeLanguageTransport } from './fake-daemon';
import { createEditorLanguage } from './ruimte-editor-language';
import { RuimteProject } from './ruimte-project';

const uri = 'file:///work/app/src/a.ts';
const other = 'file:///work/app/src/b.ts';
const at = (line: number, character: number) => ({ line, character });
const range = (line: number, start: number, end: number) => ({ start: at(line, start), end: at(line, end) });

async function setup() {
    const transport = new FakeLanguageTransport();
    transport.providers = { 'textDocument/definition': {} };
    let answer: unknown = null;
    transport.answers.set('language.request', () => ({ result: answer, server: 'typescript', version: 1 }));
    const opened: Array<{ path: string; line: number }> = [];
    const project = new RuimteProject(transport, 'p1', '/work/app', null, (_folder, path, line) => opened.push({ path, line }));
    const engine = new FakeEditorEngine();
    const editor = engine.mount({} as HTMLElement, { text: 'one\ntwo\nthree\nlet value = 1;', theme: 'light' });
    const language = createEditorLanguage(project, editor, uri, 'typescript');
    await language.document.ready;
    return { engine, editor, language, project, opened, answer: (value: unknown) => (answer = value) };
}

describe('jumps between files', () => {
    test('walks across files: Back opens the file the caret came from, on its line, and the column follows once its editor is there', async () => {
        const { engine, editor, language, project, opened, answer } = await setup();
        answer({ uri: other, range: range(5, 3, 8) });
        editor.moveCaret(at(2, 4));
        await language.navigation.go('definition');
        expect(opened).toEqual([{ path: '/work/app/src/b.ts', line: 6 }]);
        const secondEditor = engine.mount({} as HTMLElement, { text: '\n\n\n\n\nlet other = 2;\n', theme: 'light' });
        const second = createEditorLanguage(project, secondEditor, other, 'typescript');
        await second.document.ready;
        // The file opened on the line; the history's column arrives with the editor.
        secondEditor.moveCaret(at(5, 0));
        expect(secondEditor.getCaret()).toEqual(at(5, 3));
        second.history.back();
        expect(opened.at(-1)).toEqual({ path: '/work/app/src/a.ts', line: 3 });
        expect(project.language.history.canGoForward({ uri, position: at(2, 4) })).toBe(true);
    });

    test('the Problems panel records the caret it left', async () => {
        const { editor, project, opened } = await setup();
        editor.moveCaret(at(2, 1));
        project.language.jumpTo({ uri: other, position: at(8, 2) });
        expect(opened).toEqual([{ path: '/work/app/src/b.ts', line: 9 }]);
        expect(project.language.history.recent({ uri: other, position: at(8, 2) })).toEqual([{ uri, position: at(2, 1) }]);
    });
});
