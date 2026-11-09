import { beforeEach, describe, expect, test } from 'bun:test';
import { keyOf as eventOf, settle } from '@adecore/editor-react/testing';
import { FakeEditorEngine } from '@adecore/editor/fake';
import { useToasts } from '@/state/toasts';
import { keyOf } from '@/surface/shortcut-overrides';
import { installWorkspaceRegistries } from '@/wiring/workspace-registries';
import { FakeLanguageTransport, readOnlyFiles } from './fake-daemon';
import { createEditorLanguage } from './ruimte-editor-language';
import { RuimteProject } from './ruimte-project';

// An editor is drawn only in a workspace, whose chunk installs this before it draws one (`App.tsx`).
installWorkspaceRegistries();

const uri = 'file:///work/app/src/a.ts';
const otherUri = 'file:///work/app/src/b.ts';
const at = (line: number, character: number) => ({ line, character });
const place = (target: string, line: number) => ({ uri: target, range: { start: at(line, 4), end: at(line, 9) } });

async function setup(answer: unknown, providers: Record<string, unknown> = { 'textDocument/references': {} }) {
    const transport = new FakeLanguageTransport();
    transport.providers = providers;
    transport.answers.set('language.request', () => ({ result: answer, server: 'typescript', version: 1 }));
    const project = new RuimteProject(transport, 'p1', '/work/app', readOnlyFiles({ '/work/app/src/b.ts': 'x\ny\nuse(value);' }));
    const editor = new FakeEditorEngine().mount({} as HTMLElement, { text: 'let value = 1;\nvalue + 1;\n', theme: 'light' });
    const language = createEditorLanguage(project, editor, uri, 'typescript');
    await language.document.ready;
    return { editor, language, transport };
}

beforeEach(() => {
    useToasts.setState({ toasts: [] });
});

describe('peek references', () => {
    test('opens a row under the caret line with every place, on the first one that is not the caret', async () => {
        const { editor, language } = await setup([place(uri, 0), place(uri, 1), place(otherUri, 2)]);
        editor.moveCaret(at(0, 5));
        await language.peek.open();
        const view = language.popups.slot('peek').get()!;
        expect(view.count).toBe(3);
        expect(view.files.map((file) => file.places.map((entry) => entry.text))).toEqual([['let value = 1;', 'value + 1;'], ['use(value);']]);
        expect(view.active).toBe('0:1');
        expect(view.preview).toMatchObject({ uri, startLine: 0, active: 1 });
        expect(editor.widgets).toMatchObject([{ line: 0 }]);
    });

    test('asks for the usages without the declaration, as the count above a declaration does', async () => {
        const { language, transport } = await setup([place(uri, 1)]);
        await language.peek.open();
        const request = transport.callsOf('language.request').find((call) => (call.payload as { method: string }).method === 'textDocument/references');
        expect((request!.payload as { params: { context: unknown } }).params.context).toEqual({ includeDeclaration: false });
    });

    test('follows the arrows and shows the code of another file, and Enter goes to the place', async () => {
        const { editor, language } = await setup([place(uri, 1), place(otherUri, 2)]);
        editor.moveCaret(at(0, 5));
        await language.peek.open();
        expect(editor.press({ key: 'ArrowDown' })).toBe(true);
        expect(language.popups.slot('peek').get()).toMatchObject({ active: '1:0', preview: { uri: otherUri, text: 'x\ny\nuse(value);' } });
        editor.press({ key: 'ArrowUp' });
        editor.press({ key: 'Enter' });
        expect(language.popups.slot('peek').get()).toBeNull();
        expect(editor.widgets).toEqual([]);
        expect(editor.getCaret()).toEqual(at(1, 4));
    });

    test('leaves the places of a folded file to the arrows and brings them back', async () => {
        const { editor, language } = await setup([place(uri, 1), place(uri, 0), place(otherUri, 2)]);
        editor.moveCaret(at(0, 5));
        await language.peek.open();
        expect(language.popups.slot('peek').get()!.active).toBe('0:1');
        language.peek.toggleFile(otherUri);
        editor.press({ key: 'ArrowDown' });
        expect(language.popups.slot('peek').get()!.active).toBe('0:1');
        language.peek.toggleFile(otherUri);
        expect(language.popups.slot('peek').get()!.collapsed).toEqual([]);
        editor.press({ key: 'ArrowDown' });
        expect(language.popups.slot('peek').get()!.active).toBe('1:0');
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
        expect(language.popups.slot('peek').get()).not.toBeNull();
    });

    test('stops at the ends of the list and gives the keyboard back to the caret on Escape', async () => {
        const { editor, language } = await setup([place(uri, 1), place(otherUri, 2)]);
        editor.moveCaret(at(0, 5));
        await language.peek.open();
        editor.press({ key: 'ArrowUp' });
        expect(language.popups.slot('peek').get()!.active).toBe('0:0');
        editor.press({ key: 'ArrowDown' });
        editor.press({ key: 'ArrowDown' });
        expect(language.popups.slot('peek').get()!.active).toBe('1:0');
        editor.blur();
        editor.press({ key: 'Escape' });
        expect(language.popups.slot('peek').get()).toBeNull();
        expect(editor.focused).toBe(true);
        expect(editor.getCaret()).toEqual(at(0, 5));
    });

    test('closes on Escape and when the text changes, and says so when there is nothing', async () => {
        const { editor, language } = await setup([place(uri, 1)]);
        await language.peek.open();
        editor.press({ key: 'Escape' });
        expect(language.popups.slot('peek').get()).toBeNull();
        await language.peek.open();
        editor.type('let value = 12;\nvalue + 1;\n');
        expect(language.popups.slot('peek').get()).toBeNull();
        const none = await setup(null);
        await none.language.peek.open();
        expect(useToasts.getState().toasts.at(-1)?.title).toBe('No references found');
    });
});

describe('peek again while open', () => {
    test('draws the block of a second peek in a row of its own, so its panel has a place to render', async () => {
        const { editor, language } = await setup([place(uri, 0), place(uri, 1), place(otherUri, 2)]);
        await language.peek.open(at(0, 5));
        expect(language.popups.slot('peek').get()!.container).not.toBeNull();
        await language.peek.open(at(1, 1));
        const view = language.popups.slot('peek').get()!;
        expect(view.container).not.toBeNull();
        expect(editor.widgets).toMatchObject([{ line: 1 }]);
        editor.press({ key: 'Escape' });
        await language.peek.open(at(0, 5));
        expect(language.popups.slot('peek').get()!.container).not.toBeNull();
    });
});

describe('peek definition', () => {
    test('shows the whole declaration of the definition in its file and goes there on Enter', async () => {
        const link = { targetUri: otherUri, targetRange: { start: at(0, 0), end: at(2, 1) }, targetSelectionRange: { start: at(2, 4), end: at(2, 9) } };
        const transport = new FakeLanguageTransport();
        transport.providers = { 'textDocument/definition': {} };
        transport.answers.set('language.request', () => ({ result: [link], server: 'typescript', version: 1 }));
        const opened: unknown[] = [];
        const project = new RuimteProject(
            transport,
            'p1',
            '/work/app',
            readOnlyFiles({ '/work/app/src/b.ts': 'function use() {\n  return 1;\n    }\nother();' }),
            (...args) => opened.push(args)
        );
        const editor = new FakeEditorEngine().mount({} as HTMLElement, { text: 'use();', theme: 'light' });
        const language = createEditorLanguage(project, editor, uri, 'typescript');
        await language.document.ready;
        editor.press(eventOf(keyOf('peekDefinition')!));
        await settle();
        const view = language.popups.slot('peek').get()!;
        expect(view.kind).toBe('definitions');
        expect(view.preview).toMatchObject({ uri: otherUri, startLine: 0, text: 'function use() {\n  return 1;\n    }', active: 2 });
        editor.press({ key: 'Enter' });
        expect(language.popups.slot('peek').get()).toBeNull();
        expect(opened).toEqual([['/work/app', '/work/app/src/b.ts', 3]]);
        const target = new FakeEditorEngine().mount({} as HTMLElement, { text: 'function use() {\n  return 1;\n    }\nother();', theme: 'light' });
        target.setCaret(at(2, 0));
        const targetLanguage = createEditorLanguage(project, target, otherUri, 'typescript');
        await targetLanguage.document.ready;
        expect(target.getCaret()).toEqual(at(2, 4));
        targetLanguage.dispose();
        language.dispose();
        project.dispose();
    });

    test('says so when there is no definition or no server for it', async () => {
        const { language } = await setup(null);
        await language.peek.openDefinition();
        expect(useToasts.getState().toasts.at(-1)?.title).toBe('Definitions unavailable in this file');
        const supported = await setup(null, { 'textDocument/definition': {} });
        await supported.language.peek.openDefinition();
        expect(useToasts.getState().toasts.at(-1)?.title).toBe('No definition found');
    });
});
