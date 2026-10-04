import { beforeEach, describe, expect, test } from 'bun:test';
import { FakeEditorEngine } from '@ruimte/smart-editor/fake';
import { useToasts } from '@/state/toasts';
import { EditorLanguage } from './editor-language';
import { FakeLanguageTransport } from './fake-daemon';
import { distinguishingFolders } from './peek-model';
import { ProjectLanguage } from './project-language';

const uri = 'file:///work/app/src/a.ts';
const otherUri = 'file:///work/app/src/b.ts';
const at = (line: number, character: number) => ({ line, character });
const place = (target: string, line: number) => ({ uri: target, range: { start: at(line, 4), end: at(line, 9) } });

async function setup(answer: unknown) {
    const transport = new FakeLanguageTransport();
    transport.providers = { 'textDocument/references': {} };
    transport.answers.set('language.request', () => ({ result: answer, server: 'typescript', version: 1 }));
    const project = new ProjectLanguage(transport, 'p1', '/work/app', {
        read: async (path) => (path === '/work/app/src/b.ts' ? { text: 'x\ny\nuse(value);', mtime: 1 } : null),
        stage: () => undefined
    });
    const editor = new FakeEditorEngine().mount({} as HTMLElement, { text: 'let value = 1;\nvalue + 1;\n', theme: 'light' });
    const language = new EditorLanguage(project, editor, uri, 'typescript');
    await language.document.ready;
    return { editor, language };
}

beforeEach(() => {
    useToasts.setState({ toasts: [] });
});

describe('peek references', () => {
    test('opens a row under the caret line with every place, on the first one that is not the caret', async () => {
        const { editor, language } = await setup([place(uri, 0), place(uri, 1), place(otherUri, 2)]);
        editor.moveCaret(at(0, 5));
        await language.peek.open();
        const view = language.popups.getState().peek!;
        expect(view.count).toBe(3);
        expect(view.files.map((file) => file.places.map((entry) => entry.text))).toEqual([['let value = 1;', 'value + 1;'], ['use(value);']]);
        expect(view.active).toBe('0:1');
        expect(view.preview).toMatchObject({ uri, startLine: 0, active: 1 });
        expect(editor.widgets).toMatchObject([{ id: 'peek', line: 0 }]);
    });

    test('follows the arrows and shows the code of another file, and Enter goes to the place', async () => {
        const { editor, language } = await setup([place(uri, 1), place(otherUri, 2)]);
        editor.moveCaret(at(0, 5));
        await language.peek.open();
        expect(editor.press({ key: 'ArrowDown' })).toBe(true);
        expect(language.popups.getState().peek).toMatchObject({ active: '1:0', preview: { uri: otherUri, text: 'x\ny\nuse(value);' } });
        editor.press({ key: 'ArrowUp' });
        editor.press({ key: 'Enter' });
        expect(language.popups.getState().peek).toBeNull();
        expect(editor.widgets).toEqual([]);
        expect(editor.getCaret()).toEqual(at(1, 4));
    });

    test('takes the keyboard when it opens, so the arrows work without a click and leave the caret alone', async () => {
        const { editor, language } = await setup([place(uri, 1), place(otherUri, 2)]);
        editor.moveCaret(at(0, 5));
        editor.blur();
        await language.peek.open();
        expect(editor.focused).toBe(true);
        editor.press({ key: 'ArrowDown' });
        editor.press({ key: 'ArrowUp' });
        expect(editor.getCaret()).toEqual(at(0, 5));
        expect(language.popups.getState().peek).not.toBeNull();
    });

    test('stops at the ends of the list and gives the keyboard back to the caret on Escape', async () => {
        const { editor, language } = await setup([place(uri, 1), place(otherUri, 2)]);
        editor.moveCaret(at(0, 5));
        await language.peek.open();
        editor.press({ key: 'ArrowDown' });
        editor.press({ key: 'ArrowDown' });
        expect(language.popups.getState().peek!.active).toBe('1:0');
        editor.blur();
        editor.press({ key: 'Escape' });
        expect(language.popups.getState().peek).toBeNull();
        expect(editor.focused).toBe(true);
        expect(editor.getCaret()).toEqual(at(0, 5));
    });

    test('closes on Escape and when the text changes, and says so when there is nothing', async () => {
        const { editor, language } = await setup([place(uri, 1)]);
        await language.peek.open();
        editor.press({ key: 'Escape' });
        expect(language.popups.getState().peek).toBeNull();
        await language.peek.open();
        editor.type('let value = 12;\nvalue + 1;\n');
        expect(language.popups.getState().peek).toBeNull();
        const none = await setup(null);
        await none.language.peek.open();
        expect(useToasts.getState().toasts.at(-1)?.title).toBe('No references found');
    });
});

describe('files with the same name in the list', () => {
    test('shows the folders that tell them apart, and nothing for a name of its own', () => {
        expect(distinguishingFolders(['src/a/TestData.php', 'src/b/TestData.php', 'src/Other.php'])).toEqual(['a', 'b', '']);
    });

    test('goes up as many folders as it takes', () => {
        expect(distinguishingFolders(['tests/one/Fixtures/Data.php', 'tests/two/Fixtures/Data.php', 'tests/one/Data.php'])).toEqual([
            'one/Fixtures',
            'two/Fixtures',
            'one'
        ]);
    });

    test('tells a file in the root from one in a folder', () => {
        expect(distinguishingFolders(['a.ts', 'src/a.ts'])).toEqual(['', 'src']);
    });
});
