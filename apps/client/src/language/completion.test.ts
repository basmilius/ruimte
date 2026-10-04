import { describe, expect, test } from 'bun:test';
import { FakeEditorEngine } from '@ruimte/smart-editor/fake';
import type { CompletionItem } from '@ruimte/smart-editor-lsp';
import { EditorLanguage } from './editor-language';
import { FakeLanguageTransport } from './fake-daemon';
import { ProjectLanguage } from './project-language';
import { ManualTimers } from './timers';

const uri = 'file:///work/app/src/a.ts';
const at = (line: number, character: number) => ({ line, character });

async function settle(): Promise<void> {
    for (let turn = 0; turn < 200; turn++) {
        await Promise.resolve();
    }
}

const ITEMS: CompletionItem[] = [
    { label: 'filter', kind: 2, labelDetails: { detail: '(predicate, thisArg?)' }, sortText: '1' },
    { label: 'fill', kind: 2, sortText: '0' },
    { label: 'findLast', kind: 2, sortText: '2' },
    { label: 'map', kind: 2, sortText: '3' }
];

/* Types the text a character at a time from what the editor holds, as a person does. */
async function typeIn(editor: { getText(): string; type(text: string): void }, text: string, afterFirst?: () => Promise<void>): Promise<void> {
    for (const character of text) {
        editor.type(editor.getText() + character);
        await afterFirst?.();
    }
}

async function setup(text = 'items.') {
    const transport = new FakeLanguageTransport();
    transport.providers = { 'textDocument/completion': { triggerCharacters: ['.'] }, 'completionItem/resolve': { resolveProvider: true } };
    const requests: { method: string; params: unknown }[] = [];
    transport.answers.set('language.request', (payload: { method: string; params: unknown }) => {
        requests.push(payload);
        const result =
            payload.method === 'completionItem/resolve'
                ? {
                      ...(payload.params as CompletionItem),
                      documentation: 'Resolved docs',
                      detail: 'filter(): void',
                      additionalTextEdits: [{ range: { start: at(0, 0), end: at(0, 0) }, newText: "import 'x';\n" }]
                  }
                : { isIncomplete: false, items: ITEMS };
        return { result, server: 'typescript', version: 1 };
    });
    const project = new ProjectLanguage(transport, 'p1', '/work/app');
    const editor = new FakeEditorEngine().mount({} as HTMLElement, { text, theme: 'light' });
    editor.moveCaret(at(0, text.length));
    const timers = new ManualTimers();
    const language = new EditorLanguage(project, editor, uri, 'typescript', timers);
    await language.document.ready;
    return { editor, language, timers, requests, view: () => language.popups.getState().completion };
}

describe('opening', () => {
    test('opens after a trigger character with every suggestion, and after an identifier character filtered by what was typed', async () => {
        const { editor, timers, view, requests } = await setup('items');
        editor.type('items.');
        timers.advance(10);
        await settle();
        expect(requests.filter((entry) => entry.method === 'textDocument/completion')).toHaveLength(1);
        expect(view()?.rows.map((row) => row.label)).toEqual(['fill', 'filter', 'findLast', 'map']);
        editor.type('items.f');
        await settle();
        expect(view()?.rows.map((row) => row.label)).toEqual(['fill', 'filter', 'findLast']);
        editor.type('items.fil');
        await settle();
        expect(view()?.rows.map((row) => row.label)).toEqual(['fill', 'filter', 'findLast']);
        editor.type('items.fill');
        await settle();
        expect(view()?.rows.map((row) => row.label)).toEqual(['fill']);
        expect(requests.filter((entry) => entry.method === 'textDocument/completion')).toHaveLength(1);
    });

    test('opens for the first letter of a word, after a short pause', async () => {
        const { editor, timers, view } = await setup('');
        editor.type('f');
        expect(view()).toBeNull();
        timers.advance(100);
        await settle();
        expect(view()?.rows.length).toBeGreaterThan(0);
        expect(view()?.anchor).toEqual(at(0, 0));
    });

    test('stays shut for a space, a paste and an outside change, and closes when nothing fits', async () => {
        const { editor, timers, view } = await setup('items.');
        editor.type('items. ');
        timers.advance(200);
        await settle();
        expect(view()).toBeNull();
        editor.setText('items');
        timers.advance(200);
        await settle();
        expect(view()).toBeNull();
        editor.type('items.');
        timers.advance(10);
        await settle();
        expect(view()).not.toBeNull();
        await typeIn(editor, 'zzz');
        await settle();
        expect(view()).toBeNull();
    });
});

describe('keys', () => {
    test("arrows move, Escape closes, and the keys are the list's only while it is open", async () => {
        const { editor, timers, view } = await setup('items.');
        expect(editor.press({ key: 'ArrowDown' })).toBe(false);
        editor.type('items.f');
        timers.advance(200);
        await settle();
        expect(view()?.active).toBe(0);
        expect(editor.press({ key: 'ArrowDown' })).toBe(true);
        expect(view()?.active).toBe(1);
        expect(editor.press({ key: 'ArrowUp' })).toBe(true);
        expect(editor.press({ key: 'ArrowUp' })).toBe(true);
        expect(view()?.active).toBe(0);
        expect(editor.press({ key: 'Escape' })).toBe(true);
        expect(view()).toBeNull();
    });

    test('leaves a key with a modifier to the app', async () => {
        const { editor, timers } = await setup('items.');
        editor.type('items.f');
        timers.advance(200);
        await settle();
        expect(editor.press({ key: 'Enter', metaKey: true })).toBe(false);
        expect(editor.press({ key: 'Tab', shiftKey: true })).toBe(false);
    });

    test('Ctrl+Space opens the list and then shows or hides the documentation', async () => {
        const { editor, timers, view } = await setup('items.f');
        expect(editor.press({ key: ' ', ctrlKey: true })).toBe(true);
        timers.advance(10);
        await settle();
        expect(view()?.detailsOpen).toBe(true);
        editor.press({ key: ' ', ctrlKey: true });
        expect(view()?.detailsOpen).toBe(false);
    });
});

describe('accepting', () => {
    test('Enter replaces the typed word with the item, and takes the edits the item resolves with', async () => {
        const { editor, timers, view } = await setup('items');
        editor.type('items.');
        timers.advance(200);
        await settle();
        await typeIn(editor, 'fi');
        editor.press({ key: 'ArrowDown' });
        editor.press({ key: 'Enter' });
        await settle();
        expect(editor.getText()).toBe("import 'x';\nitems.filter");
        expect(view()).toBeNull();
    });

    test('shows the documentation the server resolves for the active row', async () => {
        const { editor, timers, view } = await setup('items');
        editor.type('items.');
        timers.advance(200);
        await settle();
        await typeIn(editor, 'fi');
        timers.advance(200);
        await settle();
        timers.advance(200);
        await settle();
        expect(view()?.docs).toEqual({ signature: 'filter(): void', markdown: 'Resolved docs' });
    });

    test('closes when the caret leaves the word', async () => {
        const { editor, timers, view } = await setup('items');
        editor.type('items.f');
        timers.advance(200);
        await settle();
        editor.moveCaret(at(0, 3));
        expect(view()).toBeNull();
    });
});
