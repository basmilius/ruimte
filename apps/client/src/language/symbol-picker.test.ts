import { beforeEach, describe, expect, test } from 'bun:test';
import { FakeEditorEngine } from '@adecore/editor/fake';
import { useToasts } from '@/state/toasts';
import { EditorLanguage } from './ruimte-editor-language';
import { FakeLanguageTransport } from './fake-daemon';
import { ProjectLanguage } from './ruimte-project-language';
import { CANVAS_SHORTCUTS } from '@/canvas/shortcuts';
import { eventOf } from './key-events';

const uri = 'file:///work/app/src/a.ts';
const at = (line: number, character = 0) => ({ line, character });
const range = (line: number) => ({ start: at(line), end: at(line, 5) });

async function setup(providers: Record<string, unknown> = { 'textDocument/documentSymbol': {}, 'workspace/symbol': {} }) {
    const transport = new FakeLanguageTransport();
    transport.providers = providers;
    transport.answers.set('language.request', (payload: { method: string }) => {
        const result =
            payload.method === 'workspace/symbol'
                ? [{ name: 'Bus', kind: 5, location: { uri: 'file:///work/app/src/bus.ts', range: range(7) } }]
                : [
                      { name: 'score', kind: 12, selectionRange: { start: at(2, 9), end: at(2, 14) }, range: range(2) },
                      { name: 'DEFAULT', kind: 14, selectionRange: range(0), range: range(0) }
                  ];
        return { result, server: 'typescript', version: 1 };
    });
    const project = new ProjectLanguage(transport, 'p1', '/work/app');
    const editor = new FakeEditorEngine().mount({} as HTMLElement, { text: 'const DEFAULT = 1;\n\nfunction score() {}\n', theme: 'light' });
    const language = new EditorLanguage(project, editor, uri, 'typescript');
    await language.document.ready;
    return { editor, language };
}

beforeEach(() => {
    useToasts.setState({ toasts: [] });
});

describe('go to symbol', () => {
    test('opens on its shortcut with the symbols of the file and goes to the one chosen', async () => {
        const { editor, language } = await setup();
        expect(editor.press(eventOf(CANVAS_SHORTCUTS.goToSymbol))).toBe(true);
        for (let turn = 0; turn < 100; turn++) {
            await Promise.resolve();
        }
        const view = language.popups.getState().symbols!;
        expect(view.file).toBe('a.ts');
        expect(view.entries.map((entry) => entry.name)).toEqual(['score', 'DEFAULT']);
        language.symbolPicker.goTo(view.entries[0]!);
        expect(editor.getCaret()).toEqual(at(2, 9));
        expect(language.popups.getState().symbols).toBeNull();
    });

    test('goes to a line, and to a symbol of the project', async () => {
        const { editor, language } = await setup();
        await language.symbolPicker.open();
        language.symbolPicker.goToLine(3);
        expect(editor.getCaret()).toEqual(at(2, 0));
        const found = await language.symbolPicker.search('Bus', new AbortController().signal);
        expect(found).toMatchObject([{ name: 'Bus', line: 7, uri: 'file:///work/app/src/bus.ts' }]);
        expect(await language.symbolPicker.search('', new AbortController().signal)).toEqual([]);
    });

    test('says so when no server knows the symbols', async () => {
        const { language } = await setup({});
        await language.symbolPicker.open();
        expect(language.popups.getState().symbols).toBeNull();
        expect(useToasts.getState().toasts[0]?.title).toBe('No language server knows the symbols of this file');
    });
});
