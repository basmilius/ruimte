import { describe, expect, test } from 'bun:test';
import { FakeEditorEngine } from '@ruimte/smart-editor/fake';
import { EditorLanguage } from './editor-language';
import { FakeLanguageTransport } from './fake-daemon';
import { ProjectLanguage } from './project-language';

const uri = 'file:///work/app/src/a.ts';
const at = (line: number, character: number) => ({ line, character });
const range = (line: number, start: number, end: number) => ({ start: at(line, start), end: at(line, end) });

describe('problem navigation', () => {
    async function setup() {
        const transport = new FakeLanguageTransport();
        const project = new ProjectLanguage(transport, 'p1', '/work/app');
        const editor = new FakeEditorEngine().mount({} as HTMLElement, { text: 'one\ntwo\nthree', theme: 'light' });
        const language = new EditorLanguage(project, editor, uri, 'typescript');
        await language.document.ready;
        transport.emit('language.diagnostics', {
            projectId: 'p1',
            path: 'src/a.ts',
            server: 'typescript',
            version: 1,
            diagnostics: [
                { range: range(0, 0, 3), message: 'first', severity: 1 },
                { range: range(2, 0, 5), message: 'second', severity: 2 }
            ]
        });
        return { editor };
    }

    test('steps to the next problem with Alt+F8 and back with Alt+Shift+F8', async () => {
        const { editor } = await setup();
        editor.moveCaret(at(1, 1));
        expect(editor.press({ key: 'F8', altKey: true })).toBe(true);
        expect(editor.getCaret()).toEqual(at(2, 0));
        editor.press({ key: 'F8', altKey: true, shiftKey: true });
        expect(editor.getCaret()).toEqual(at(0, 0));
        editor.press({ key: 'F8', altKey: true });
        expect(editor.getCaret()).toEqual(at(2, 0));
        editor.press({ key: 'F8', altKey: true, shiftKey: true });
        expect(editor.getCaret()).toEqual(at(0, 0));
    });

    test('shows the card of the problem it lands on, and drops it when the caret moves on', async () => {
        const transport = new FakeLanguageTransport();
        const project = new ProjectLanguage(transport, 'p1', '/work/app');
        const editor = new FakeEditorEngine().mount({} as HTMLElement, { text: 'one\ntwo\nthree', theme: 'light' });
        const language = new EditorLanguage(project, editor, uri, 'typescript');
        await language.document.ready;
        transport.emit('language.diagnostics', {
            projectId: 'p1',
            path: 'src/a.ts',
            server: 'typescript',
            version: 1,
            diagnostics: [{ range: range(2, 0, 5), message: 'second', severity: 2 }]
        });
        editor.press({ key: 'F8', altKey: true });
        expect(language.popups.getState().hover?.problems[0]?.diagnostic.message).toBe('second');
        editor.scroll();
        expect(language.popups.getState().hover).not.toBeNull();
        editor.moveCaret(at(0, 0));
        expect(language.popups.getState().hover).toBeNull();
    });

    test('leaves a bare F8 alone', async () => {
        const { editor } = await setup();
        editor.moveCaret(at(1, 1));
        expect(editor.press({ key: 'F8' })).toBe(false);
        expect(editor.getCaret()).toEqual(at(1, 1));
    });
});
