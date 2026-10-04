import { describe, expect, test } from 'bun:test';
import { FakeEditorEngine } from '@ruimte/smart-editor/fake';
import { EditorLanguage } from './editor-language';
import { FakeLanguageTransport } from './fake-daemon';
import { ProjectLanguage } from './project-language';

const uri = 'file:///work/app/src/a.ts';
const at = (line: number, character: number) => ({ line, character });
const range = (line: number, start: number, end: number) => ({ start: at(line, start), end: at(line, end) });

async function settle(): Promise<void> {
    for (let turn = 0; turn < 50; turn++) {
        await Promise.resolve();
    }
}

async function setup(answer: unknown, providers: Record<string, unknown> = { 'textDocument/definition': {} }) {
    const transport = new FakeLanguageTransport();
    transport.providers = providers;
    const asked: unknown[] = [];
    transport.answers.set('language.request', (payload: { params: unknown }) => {
        asked.push(payload.params);
        return { result: answer, server: 'typescript', version: 1 };
    });
    const project = new ProjectLanguage(transport, 'p1', '/work/app');
    const editor = new FakeEditorEngine().mount({} as HTMLElement, { text: 'let value = salaryFit(1);', theme: 'light' });
    const language = new EditorLanguage(project, editor, uri, 'typescript');
    await language.document.ready;
    return { editor, language, asked };
}

describe('the definition link', () => {
    test('underlines the name under the pointer while the modifier is held and a definition exists', async () => {
        const { editor, language, asked } = await setup({ uri, range: range(0, 4, 9) });
        editor.hover(at(0, 14));
        await settle();
        expect(editor.link).toBeNull();
        expect(asked).toHaveLength(0);
        language.definitionLink.setModHeld(true);
        await settle();
        expect(editor.link).toEqual(range(0, 12, 21));
        editor.hover(at(0, 5));
        await settle();
        expect(editor.link).toEqual(range(0, 4, 9));
        language.definitionLink.setModHeld(false);
        expect(editor.link).toBeNull();
    });

    test('draws nothing where no definition is found, off a name and when the file has no such server', async () => {
        const none = await setup(null);
        none.language.definitionLink.setModHeld(true);
        none.editor.hover(at(0, 14));
        await none.language.document.ready;
        await settle();
        expect(none.editor.link).toBeNull();
        const found = await setup({ uri, range: range(0, 4, 9) });
        found.language.definitionLink.setModHeld(true);
        found.editor.hover(at(0, 3));
        await settle();
        expect(found.editor.link).toBeNull();
        const unserved = await setup({ uri, range: range(0, 4, 9) }, {});
        unserved.language.definitionLink.setModHeld(true);
        unserved.editor.hover(at(0, 14));
        await settle();
        expect(unserved.editor.link).toBeNull();
        expect(unserved.asked).toHaveLength(0);
    });

    test('goes when the pointer leaves the text or the text changes', async () => {
        const { editor, language } = await setup({ uri, range: range(0, 4, 9) });
        language.definitionLink.setModHeld(true);
        editor.hover(at(0, 14));
        await settle();
        expect(editor.link).not.toBeNull();
        editor.hover(null);
        expect(editor.link).toBeNull();
        editor.hover(at(0, 14));
        await settle();
        editor.type('// x\nlet value = salaryFit(1);');
        expect(editor.link).toBeNull();
    });
});
