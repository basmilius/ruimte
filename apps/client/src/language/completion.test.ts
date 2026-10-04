import { beforeEach, describe, expect, test } from 'bun:test';
import { FakeEditorEngine } from '@ruimte/smart-editor/fake';
import type { CompletionItem } from '@ruimte/smart-editor-lsp';
import { EditorLanguage } from './editor-language';
import { FakeLanguageTransport } from './fake-daemon';
import { ProjectLanguage } from './project-language';
import { useToasts } from '@/state/toasts';
import { forgetRecentChoices } from './recent-choices';
import { ManualTimers } from './timers';
import { CANVAS_SHORTCUTS } from '@/canvas/shortcuts';
import { eventOf } from './key-events';

const uri = 'file:///work/app/src/a.ts';
const at = (line: number, character: number) => ({ line, character });

async function settle(): Promise<void> {
    for (let turn = 0; turn < 200; turn++) {
        await Promise.resolve();
    }
}

beforeEach(() => forgetRecentChoices());

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

async function setup(text = 'items.', items: CompletionItem[] = ITEMS) {
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
                : { isIncomplete: false, items };
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

describe('the active row', () => {
    const items: CompletionItem[] = [
        { label: 'fooBar', kind: 2, sortText: '0' },
        { label: 'bar', kind: 2, sortText: '1' },
        { label: 'baz', kind: 2, sortText: '2' }
    ];

    test('follows the best match while the person has not moved in the list', async () => {
        const { editor, timers, view } = await setup('', items);
        editor.type('b');
        timers.advance(100);
        await settle();
        expect(view()?.rows.map((row) => row.label)).toEqual(['bar', 'baz', 'fooBar']);
        expect(view()?.active).toBe(0);
        editor.type('ba');
        await settle();
        expect(view()?.active).toBe(0);
    });

    test('stays on the row the person moved to, wherever the typing puts it', async () => {
        const { editor, timers, view } = await setup('', items);
        editor.type('b');
        timers.advance(100);
        await settle();
        editor.press({ key: 'ArrowDown' });
        editor.press({ key: 'ArrowDown' });
        expect(view()?.rows[view()!.active]!.label).toBe('fooBar');
        editor.type('ba');
        await settle();
        expect(view()?.rows[view()!.active]!.label).toBe('fooBar');
        editor.type('baz');
        await settle();
        expect(view()?.rows.map((row) => row.label)).toEqual(['baz']);
        expect(view()?.active).toBe(0);
    });
});

describe('asking for the list', () => {
    test('inserts the only suggestion at once, and says there are none when nothing fits', async () => {
        const one = await setup('fil', [
            { label: 'filter', kind: 2 },
            { label: 'map', kind: 2 }
        ]);
        expect(one.editor.press(eventOf(CANVAS_SHORTCUTS.triggerCompletion))).toBe(true);
        one.timers.advance(10);
        await settle();
        expect(one.editor.getText()).toBe("import 'x';\nfilter");
        expect(one.view()).toBeNull();
        useToasts.setState({ toasts: [] });
        const none = await setup('zzz', ITEMS);
        none.editor.press(eventOf(CANVAS_SHORTCUTS.triggerCompletion));
        none.timers.advance(10);
        await settle();
        expect(none.view()).toBeNull();
        expect(useToasts.getState().toasts.some((toast) => toast.id === 'language-completion')).toBe(true);
    });

    test('lists several suggestions as usual', async () => {
        const { editor, timers, view } = await setup('fi');
        editor.press(eventOf(CANVAS_SHORTCUTS.triggerCompletion));
        timers.advance(10);
        await settle();
        expect(view()?.rows.length).toBe(3);
    });
});

describe('commit characters', () => {
    const items: CompletionItem[] = [
        { label: 'fill', kind: 2, sortText: '0', commitCharacters: ['.', '('] },
        { label: 'filter', kind: 2, sortText: '1', commitCharacters: ['.', '('], insertText: 'filter(${1:predicate})$0', insertTextFormat: 2 }
    ];

    async function open(text = '') {
        const mounted = await setup(text, items);
        mounted.editor.type('f');
        mounted.timers.advance(100);
        await settle();
        return mounted;
    }

    test('commit the active row after the person moved in the list, and the character follows the name', async () => {
        const { editor, view } = await open();
        editor.press({ key: 'ArrowDown' });
        expect(editor.press({ key: '.' })).toBe(true);
        await settle();
        expect(editor.getText()).toBe("import 'x';\nfilter.");
        expect(editor.getCaret()).toEqual(at(1, 7));
        expect(view()).toBeNull();
    });

    test('leave a typed character alone before the person moved, and after a list that was asked for the keyboard commits', async () => {
        const first = await open();
        expect(first.editor.press({ key: '.' })).toBe(false);
        const second = await setup('', items);
        expect(second.editor.press(eventOf(CANVAS_SHORTCUTS.triggerCompletion))).toBe(true);
        second.timers.advance(10);
        await settle();
        expect(second.editor.press({ key: '(' })).toBe(true);
        await settle();
        expect(second.editor.getText()).toBe("import 'x';\nfill(");
    });

    test('ask for the list after the name again when the character triggers one', async () => {
        const { editor, requests, timers } = await open();
        editor.press({ key: 'ArrowDown' });
        editor.press({ key: '.' });
        await settle();
        timers.advance(10);
        await settle();
        expect(requests.filter((entry) => entry.method === 'textDocument/completion').length).toBe(2);
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
        expect(view()?.active).toBe(0);
        expect(editor.press({ key: 'ArrowUp' })).toBe(true);
        expect(view()?.active).toBe(2);
        expect(editor.press({ key: 'ArrowDown' })).toBe(true);
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
        expect(editor.press(eventOf(CANVAS_SHORTCUTS.triggerCompletion))).toBe(true);
        timers.advance(10);
        await settle();
        expect(view()?.detailsOpen).toBe(true);
        editor.press(eventOf(CANVAS_SHORTCUTS.triggerCompletion));
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
        expect(view()?.docs).toEqual({ source: '', text: { signatures: [{ language: 'typescript', code: 'filter(): void' }], markdown: 'Resolved docs' } });
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

/* As intelephense answers `#[P`: the namespace in `labelDetails.description`, the import as `detail`. */
const PHP_ITEMS: CompletionItem[] = [
    { label: 'Parameter', kind: 4, detail: 'use Raxos\\OpenApi\\Attribute\\Parameter', labelDetails: { description: 'Raxos\\OpenApi\\Attribute' } },
    { label: 'Property', kind: 4, detail: 'use Raxos\\Database\\Orm\\Property', labelDetails: { description: 'Raxos\\Database\\Orm' } },
    { label: 'Property', kind: 4, detail: 'use Raxos\\OpenApi\\Attribute\\Property', labelDetails: { description: 'Raxos\\OpenApi\\Attribute' } },
    { label: 'parseFoo', kind: 3, detail: 'void', labelDetails: { detail: '($a, $b)', description: 'Raxos\\Database\\Orm' } }
];

describe('rows', () => {
    test('mark the characters that match, show the parameters after the label and the namespace apart, and tell two of one label apart', async () => {
        const { editor, timers, view } = await setup('', PHP_ITEMS);
        editor.type('P');
        timers.advance(100);
        await settle();
        const rows = view()!.rows;
        expect(rows.map((row) => [row.label, row.description])).toEqual([
            ['Parameter', 'Raxos\\OpenApi\\Attribute'],
            ['Property', 'Raxos\\Database\\Orm'],
            ['Property', 'Raxos\\OpenApi\\Attribute'],
            ['parseFoo', 'Raxos\\Database\\Orm']
        ]);
        expect(rows.map((row) => row.matches)).toEqual([[0], [0], [0], [0]]);
        expect(rows[3]!.detail).toBe('($a, $b)');
    });

    test('put the item chosen last time first among equal matches, the one of the other namespace staying behind', async () => {
        const { editor, language, timers, view } = await setup('', PHP_ITEMS);
        editor.type('P');
        timers.advance(100);
        await settle();
        await language.completion.accept(false, 2);
        editor.setText('');
        editor.type('P');
        timers.advance(100);
        await settle();
        expect(view()!.rows.map((row) => [row.label, row.description])).toEqual([
            ['Property', 'Raxos\\OpenApi\\Attribute'],
            ['Parameter', 'Raxos\\OpenApi\\Attribute'],
            ['Property', 'Raxos\\Database\\Orm'],
            ['parseFoo', 'Raxos\\Database\\Orm']
        ]);
    });
});
