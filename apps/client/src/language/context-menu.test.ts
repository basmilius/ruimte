import { describe, expect, test } from 'bun:test';
import { FakeEditorEngine } from '@adecore/editor/fake';
import { EditorLanguage } from './ruimte-editor-language';
import { FakeLanguageTransport } from './fake-daemon';
import { ProjectLanguage } from './ruimte-project-language';

const uri = 'file:///work/app/src/a.ts';
const at = (line: number, character: number) => ({ line, character });

async function settle(): Promise<void> {
    for (let turn = 0; turn < 100; turn++) {
        await Promise.resolve();
    }
}

async function setup() {
    const transport = new FakeLanguageTransport();
    transport.providers = { 'textDocument/codeAction': {}, 'textDocument/definition': {} };
    const asked: unknown[] = [];
    transport.answers.set('language.request', (payload: { params: unknown }) => {
        asked.push(payload.params);
        return {
            result: [
                { title: 'Extract to constant', kind: 'refactor.extract' },
                { title: 'Fix spelling', kind: 'quickfix' }
            ],
            server: 'typescript',
            version: 1
        };
    });
    const project = new ProjectLanguage(transport, 'p1', '/work/app');
    const editor = new FakeEditorEngine().mount({} as HTMLElement, { text: 'let value = 1;\nvalue + 1;', theme: 'light' });
    const language = new EditorLanguage(project, editor, uri, 'typescript');
    await language.document.ready;
    return { editor, language, asked };
}

describe('the context menu', () => {
    test('moves the caret to where it was asked for, opens at the pointer and lists the refactors once the servers say', async () => {
        const { editor, language, asked } = await setup();
        editor.openContextMenu({ position: at(1, 2), inSelection: false, x: 120, y: 80 });
        expect(editor.getCaret()).toEqual(at(1, 2));
        expect(language.popups.getState().menu).toEqual({ x: 120, y: 80, refactors: [] });
        await settle();
        expect(language.popups.getState().menu?.refactors.map((entry) => entry.action.title)).toEqual(['Extract to constant']);
        expect(asked[0]).toMatchObject({ context: { only: ['refactor'] } });
    });

    test('leaves the selection alone when the pointer is in it', async () => {
        const { editor, language } = await setup();
        editor.moveCaret(at(0, 3));
        editor.openContextMenu({ position: at(0, 5), inSelection: true, x: 10, y: 10 });
        expect(editor.getCaret()).toEqual(at(0, 3));
        language.contextMenu.close();
        expect(language.popups.getState().menu).toBeNull();
    });

    test('drops a late answer for a menu that has closed', async () => {
        const { editor, language } = await setup();
        editor.openContextMenu({ position: at(0, 1), inSelection: false, x: 1, y: 1 });
        language.contextMenu.close();
        await settle();
        expect(language.popups.getState().menu).toBeNull();
    });
});
