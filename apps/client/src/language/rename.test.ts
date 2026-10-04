import { beforeEach, describe, expect, test } from 'bun:test';
import { FakeEditorEngine } from '@ruimte/smart-editor/fake';
import { useToasts } from '@/state/toasts';
import { EditorLanguage } from './editor-language';
import { FakeLanguageTransport } from './fake-daemon';
import { ProjectLanguage } from './project-language';
import { CANVAS_SHORTCUTS } from '@/canvas/shortcuts';
import { eventOf } from './key-events';

const uri = 'file:///work/app/src/a.ts';
const otherUri = 'file:///work/app/src/b.ts';
const at = (line: number, character: number) => ({ line, character });
const range = (line: number, start: number, end: number) => ({ start: at(line, start), end: at(line, end) });

async function settle(): Promise<void> {
    for (let turn = 0; turn < 100; turn++) {
        await Promise.resolve();
    }
}

const TEXT = 'const weights = {};\nuse(weights);';

async function setup(options: { providers?: Record<string, unknown>; prepare?: unknown; edit?: unknown } = {}) {
    const transport = new FakeLanguageTransport();
    transport.providers = options.providers ?? { 'textDocument/rename': { prepareProvider: true }, 'textDocument/references': {} };
    const requests: { method: string; params: Record<string, unknown> }[] = [];
    const edit =
        options.edit !== undefined
            ? options.edit
            : {
                  changes: {
                      [uri]: [
                          { range: range(0, 6, 13), newText: 'scores' },
                          { range: range(1, 4, 11), newText: 'scores' }
                      ]
                  }
              };
    transport.answers.set('language.request', (payload: { method: string; params: Record<string, unknown> }) => {
        requests.push({ method: payload.method, params: payload.params });
        const results: Record<string, unknown> = {
            'textDocument/prepareRename': options.prepare !== undefined ? options.prepare : { range: range(0, 6, 13), placeholder: 'weights' },
            'textDocument/references': [
                { uri, range: range(0, 6, 13) },
                { uri, range: range(1, 4, 11) },
                { uri: otherUri, range: range(2, 0, 7) }
            ],
            'textDocument/rename': edit
        };
        return { result: results[payload.method] ?? null, server: 'typescript', version: 1 };
    });
    const project = new ProjectLanguage(transport, 'p1', '/work/app', {
        read: async (path) => (path === '/work/app/src/b.ts' ? { text: 'a\nb\nweights', mtime: 3 } : null),
        stage: () => undefined
    });
    const editor = new FakeEditorEngine().mount({} as HTMLElement, { text: TEXT, theme: 'light' });
    const language = new EditorLanguage(project, editor, uri, 'typescript');
    await language.document.ready;
    return { transport, requests, editor, language };
}

beforeEach(() => {
    useToasts.setState({ toasts: [] });
});

describe('rename', () => {
    test('puts the input on the symbol the server prepared and lights up every place the name has', async () => {
        const { editor, language } = await setup();
        editor.moveCaret(at(0, 8));
        expect(editor.press(eventOf(CANVAS_SHORTCUTS.rename))).toBe(true);
        await settle();
        const view = language.popups.getState().rename!;
        expect(view).toMatchObject({ phase: 'input', original: 'weights', placeholder: 'weights', range: range(0, 6, 13) });
        expect(view.occurrences).toEqual({ count: 3, files: 2 });
        expect(editor.highlights.map((highlight) => highlight.range)).toEqual([range(0, 6, 13), range(1, 4, 11)]);
    });

    test('applies the new name at once on Enter, as one edit in the open file', async () => {
        const { editor, language, requests } = await setup();
        editor.moveCaret(at(0, 8));
        await language.rename.start();
        await language.rename.submit(' scores ', false);
        expect(requests.find((request) => request.method === 'textDocument/rename')?.params).toMatchObject({ newName: 'scores', position: at(0, 6) });
        expect(editor.getText()).toBe('const scores = {};\nuse(scores);');
        expect(language.popups.getState().rename).toBeNull();
        expect(editor.highlights).toEqual([]);
    });

    test('lists what the rename changes on Shift+Enter, and applies exactly that on Enter', async () => {
        const { editor, language } = await setup();
        editor.moveCaret(at(0, 8));
        await language.rename.start();
        await language.rename.submit('scores', true);
        const view = language.popups.getState().rename!;
        expect(view.phase).toBe('preview');
        expect(view.files).toEqual([
            {
                uri,
                rows: [
                    { line: 1, before: 'const weights = {};', after: 'const scores = {};' },
                    { line: 2, before: 'use(weights);', after: 'use(scores);' }
                ]
            }
        ]);
        expect(editor.getText()).toBe(TEXT);
        await language.rename.confirm();
        expect(editor.getText()).toBe('const scores = {};\nuse(scores);');
    });

    test('changes nothing on Escape, for an empty name or for the same name', async () => {
        const { editor, language, requests } = await setup();
        editor.moveCaret(at(0, 8));
        await language.rename.start();
        language.rename.cancel();
        expect(language.popups.getState().rename).toBeNull();
        await language.rename.start();
        await language.rename.submit('weights', false);
        await language.rename.start();
        await language.rename.submit('  ', false);
        expect(requests.filter((request) => request.method === 'textDocument/rename')).toHaveLength(0);
        expect(editor.getText()).toBe(TEXT);
    });

    test('takes the word at the caret from a server that cannot prepare', async () => {
        const { editor, language } = await setup({ providers: { 'textDocument/rename': {} } });
        editor.moveCaret(at(1, 6));
        await language.rename.start();
        expect(language.popups.getState().rename).toMatchObject({ original: 'weights', range: range(1, 4, 11) });
    });

    test('says so when there is nothing to rename or the server refuses', async () => {
        const nothing = await setup({ prepare: null });
        await nothing.language.rename.start();
        expect(useToasts.getState().toasts.at(-1)?.title).toBe('There is nothing to rename here');
        const refused = await setup({ edit: null });
        refused.editor.moveCaret(at(0, 8));
        await refused.language.rename.start();
        await refused.language.rename.submit('scores', false);
        const open = refused.language.popups.getState().rename;
        expect(open).toMatchObject({ phase: 'input', busy: false, error: 'Could not rename: The language server refused the new name' });
        expect(refused.language.rename.isOpen).toBe(true);
        expect(useToasts.getState().toasts.some((toast) => toast.title.startsWith('Could not rename'))).toBe(false);
        refused.language.rename.edited();
        expect(refused.language.popups.getState().rename?.error).toBeNull();
        const off = await setup({ providers: {} });
        await off.language.rename.start();
        expect(useToasts.getState().toasts.at(-1)?.title).toBe('No language server renames in this file');
    });
});
