import { describe, expect, test } from 'bun:test';
import { FakeEditorEngine } from '@adecore/editor/fake';
import { EditorLanguage } from './ruimte-editor-language';
import { FakeLanguageTransport } from './fake-daemon';
import { ProjectLanguage } from './ruimte-project-language';
import { CANVAS_SHORTCUTS } from '@/canvas/shortcuts';
import { eventOf } from './key-events';

const uri = 'file:///work/app/src/a.ts';
const other = 'file:///work/app/src/b.ts';
const at = (line: number, character: number) => ({ line, character });
const range = (line: number, start: number, end: number) => ({ start: at(line, start), end: at(line, end) });

async function settle(): Promise<void> {
    for (let turn = 0; turn < 100; turn++) {
        await Promise.resolve();
    }
}

async function setup() {
    const transport = new FakeLanguageTransport();
    transport.providers = { 'textDocument/definition': {} };
    let answer: unknown = null;
    transport.answers.set('language.request', () => ({ result: answer, server: 'typescript', version: 1 }));
    const opened: Array<{ path: string; line: number }> = [];
    const project = new ProjectLanguage(transport, 'p1', '/work/app', null, (_folder, path, line) => opened.push({ path, line }));
    const engine = new FakeEditorEngine();
    const editor = engine.mount({} as HTMLElement, { text: 'one\ntwo\nthree\nlet value = 1;', theme: 'light' });
    const language = new EditorLanguage(project, editor, uri, 'typescript');
    await language.document.ready;
    return { engine, editor, language, project, opened, answer: (value: unknown) => (answer = value) };
}

describe('back and forward', () => {
    test('Mod+[ returns to where the caret was before a jump in this file and Mod+] goes again', async () => {
        const { editor, language, answer } = await setup();
        answer({ uri, range: range(3, 4, 9) });
        editor.moveCaret(at(0, 2));
        await language.navigation.go('definition');
        expect(editor.getCaret()).toEqual(at(3, 4));
        expect(editor.press(eventOf(CANVAS_SHORTCUTS.historyBack))).toBe(true);
        expect(editor.getCaret()).toEqual(at(0, 2));
        editor.press(eventOf(CANVAS_SHORTCUTS.historyForward));
        expect(editor.getCaret()).toEqual(at(3, 4));
    });

    test('walks across files: Back opens the file the caret came from, on its line, and the column follows once its editor is there', async () => {
        const { engine, editor, language, project, opened, answer } = await setup();
        answer({ uri: other, range: range(5, 3, 8) });
        editor.moveCaret(at(2, 4));
        await language.navigation.go('definition');
        expect(opened).toEqual([{ path: '/work/app/src/b.ts', line: 6 }]);
        const secondEditor = engine.mount({} as HTMLElement, { text: '\n\n\n\n\n\n', theme: 'light' });
        const second = new EditorLanguage(project, secondEditor, other, 'typescript');
        await second.document.ready;
        // The file opened on the line; the history's column arrives with the editor.
        secondEditor.moveCaret(at(5, 0));
        expect(secondEditor.getCaret()).toEqual(at(5, 3));
        second.history.back();
        expect(opened.at(-1)).toEqual({ path: '/work/app/src/a.ts', line: 3 });
        expect(project.history.canGoForward({ uri, position: at(2, 4) })).toBe(true);
    });

    test('says nothing and stays put without a history', async () => {
        const { editor, language } = await setup();
        editor.moveCaret(at(1, 1));
        expect(language.history.back()).toBe(false);
        expect(language.history.forward()).toBe(false);
        expect(editor.getCaret()).toEqual(at(1, 1));
    });

    test('Go to symbol records its jump', async () => {
        const { editor, language } = await setup();
        editor.moveCaret(at(0, 1));
        language.symbolPicker.goToLine(4);
        expect(editor.getCaret()).toEqual(at(3, 0));
        language.history.back();
        expect(editor.getCaret()).toEqual(at(0, 1));
    });

    test('the Problems panel records the caret it left', async () => {
        const { editor, project, opened } = await setup();
        editor.moveCaret(at(2, 1));
        project.jumpTo({ uri: other, position: at(8, 2) });
        expect(opened).toEqual([{ path: '/work/app/src/b.ts', line: 9 }]);
        expect(project.history.recent({ uri: other, position: at(8, 2) })).toEqual([{ uri, position: at(2, 1) }]);
    });
});

describe('recent locations', () => {
    test('Mod+E lists the places of the history under the caret, and choosing one jumps there', async () => {
        const { editor, language } = await setup();
        editor.moveCaret(at(0, 0));
        language.jump(at(1, 0));
        language.jump(at(3, 0));
        editor.press(eventOf(CANVAS_SHORTCUTS.recentLocations));
        await settle();
        const view = language.popups.getState().pick!;
        expect(view.groups[0]!.rows.map((row) => row.label)).toEqual(['a.ts:2', 'a.ts:1']);
        language.pick.choose(view.groups[0]!.rows[1]!.id);
        expect(editor.getCaret()).toEqual(at(0, 0));
    });
});
