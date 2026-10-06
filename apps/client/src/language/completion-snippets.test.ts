import { describe, expect, test } from 'bun:test';
import { FakeEditorEngine } from '@adecore/editor/fake';
import type { CompletionItem } from '@adecore/lsp';
import { EditorLanguage } from './ruimte-editor-language';
import { FakeLanguageTransport } from './fake-daemon';
import { ProjectLanguage } from './ruimte-project-language';
import { ManualTimers } from './timers';

const uri = 'file:///work/app/src/a.ts';
const at = (line: number, character: number) => ({ line, character });

async function settle(): Promise<void> {
    for (let turn = 0; turn < 200; turn++) {
        await Promise.resolve();
    }
}

async function setup(text: string, items: CompletionItem[], caret = text.length) {
    const transport = new FakeLanguageTransport();
    transport.providers = { 'textDocument/completion': { triggerCharacters: ['.'] } };
    transport.answers.set('language.request', () => ({ result: { isIncomplete: false, items }, server: 'typescript', version: 1 }));
    const project = new ProjectLanguage(transport, 'p1', '/work/app');
    const editor = new FakeEditorEngine().mount({} as HTMLElement, { text, theme: 'light' });
    editor.moveCaret(at(0, caret));
    const timers = new ManualTimers();
    const language = new EditorLanguage(project, editor, uri, 'typescript', timers);
    await language.document.ready;
    return { editor, language, timers };
}

const CALL: CompletionItem = { label: 'salaryFit', kind: 3, insertText: 'salaryFit(${1:amount}, ${2:rate})$0', insertTextFormat: 2 };

async function open(editor: ReturnType<FakeEditorEngine['mount']>, timers: ManualTimers, text: string): Promise<void> {
    editor.type(text);
    timers.advance(100);
    await settle();
}

describe('inserting a call', () => {
    test('selects the first parameter and lets Tab walk the others to the end', async () => {
        const { editor, language, timers } = await setup('', [CALL]);
        await open(editor, timers, 's');
        expect(editor.press({ key: 'Enter' })).toBe(true);
        await settle();
        expect(editor.getText()).toBe('salaryFit(amount, rate)');
        expect(editor.getSelection()).toEqual({ start: at(0, 10), end: at(0, 16) });
        expect(language.snippets.isActive).toBe(true);
        expect(editor.press({ key: 'Tab' })).toBe(true);
        expect(editor.getSelection()).toEqual({ start: at(0, 18), end: at(0, 22) });
        expect(editor.press({ key: 'Tab' })).toBe(true);
        expect(editor.getCaret()).toEqual(at(0, 23));
        expect(language.snippets.isActive).toBe(false);
        expect(editor.press({ key: 'Tab' })).toBe(false);
    });

    test('follows what is typed into a stop, and Shift+Tab goes back', async () => {
        const { editor, language, timers } = await setup('', [CALL]);
        await open(editor, timers, 's');
        editor.press({ key: 'Enter' });
        await settle();
        editor.type('salaryFit(1000, rate)');
        expect(language.snippets.isActive).toBe(true);
        editor.press({ key: 'Tab' });
        expect(editor.getSelection()).toEqual({ start: at(0, 16), end: at(0, 20) });
        editor.press({ key: 'Tab', shiftKey: true });
        expect(editor.getCaret()).toEqual(at(0, 14));
    });

    test('puts the caret on the final stop of a snippet without parameters', async () => {
        const { editor, language, timers } = await setup('', [{ label: 'now', kind: 3, insertText: 'now($0)', insertTextFormat: 2 }]);
        await open(editor, timers, 'n');
        editor.press({ key: 'Enter' });
        await settle();
        expect(editor.getText()).toBe('now()');
        expect(editor.getCaret()).toEqual(at(0, 4));
        expect(language.snippets.isActive).toBe(false);
    });

    test('measures the stops from where an import above pushed the insertion', async () => {
        const item: CompletionItem = { ...CALL, additionalTextEdits: [{ range: { start: at(0, 0), end: at(0, 0) }, newText: "import 'x';\n" }] };
        const { editor, timers } = await setup('', [item]);
        await open(editor, timers, 's');
        editor.press({ key: 'Enter' });
        await settle();
        expect(editor.getText()).toBe("import 'x';\nsalaryFit(amount, rate)");
        expect(editor.getSelection()).toEqual({ start: at(1, 10), end: at(1, 16) });
    });

    test('adds no parentheses when one follows', async () => {
        const { editor, timers } = await setup('(1)', [CALL], 0);
        await open(editor, timers, 's(1)');
        editor.press({ key: 'Enter' });
        await settle();
        expect(editor.getText()).toBe('salaryFit(1)');
        expect(editor.getCaret()).toEqual(at(0, 9));
    });
});

describe('ending the stops', () => {
    test('Escape, a caret that leaves the call and any change that is not typing end them', async () => {
        const { editor, language, timers } = await setup('', [CALL]);
        const start = async (): Promise<void> => {
            editor.setText('');
            await open(editor, timers, 's');
            editor.press({ key: 'Enter' });
            await settle();
            expect(language.snippets.isActive).toBe(true);
        };
        await start();
        expect(editor.press({ key: 'Escape' })).toBe(true);
        expect(language.snippets.isActive).toBe(false);
        expect(editor.press({ key: 'Escape' })).toBe(false);
        await start();
        editor.moveCaret(at(0, 100));
        expect(language.snippets.isActive).toBe(false);
        await start();
        editor.applyEdits([{ range: { start: at(0, 0), end: at(0, 0) }, text: '// ' }]);
        expect(language.snippets.isActive).toBe(false);
    });
});
