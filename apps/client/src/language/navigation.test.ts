import { beforeEach, describe, expect, test } from 'bun:test';
import { FakeEditorEngine } from '@ruimte/smart-editor/fake';
import { useToasts } from '@/state/toasts';
import { EditorLanguage } from './editor-language';
import { FakeLanguageTransport } from './fake-daemon';
import { locationRow, uniqueLocations } from './navigation';
import { ProjectLanguage } from './project-language';

const uri = 'file:///work/app/src/a.ts';
const at = (line: number, character: number) => ({ line, character });
const range = (line: number, start: number, end: number) => ({ start: at(line, start), end: at(line, end) });
const here = { uri, range: range(3, 4, 9) };
const there = { uri: 'file:///work/app/src/lib/b.ts', range: range(9, 0, 5) };

async function settle(): Promise<void> {
    for (let turn = 0; turn < 100; turn++) {
        await Promise.resolve();
    }
}

async function setup(answer: unknown, providers: Record<string, unknown> = { 'textDocument/definition': {}, 'textDocument/implementation': {} }) {
    const transport = new FakeLanguageTransport();
    transport.providers = providers;
    const methods: string[] = [];
    transport.answers.set('language.request', (payload: { method: string }) => {
        methods.push(payload.method);
        return { result: answer, server: 'typescript', version: 1 };
    });
    const project = new ProjectLanguage(transport, 'p1', '/work/app');
    const editor = new FakeEditorEngine().mount({} as HTMLElement, { text: 'one\ntwo\nthree\nlet value = 1;', theme: 'light' });
    const language = new EditorLanguage(project, editor, uri, 'typescript');
    await language.document.ready;
    return { editor, language, methods };
}

beforeEach(() => {
    useToasts.setState({ toasts: [] });
});

describe('places', () => {
    test('lists each place once, links included', () => {
        expect(uniqueLocations([here, { ...here }, there])).toEqual([here, there]);
        expect(uniqueLocations([{ targetUri: uri, targetRange: range(0, 0, 9), targetSelectionRange: range(3, 4, 9) }])).toEqual([here]);
        expect(uniqueLocations(null)).toEqual([]);
    });

    test('reads a row as the file and line, with its folder', () => {
        expect(locationRow(there, 'src/lib/b.ts')).toEqual({ label: 'b.ts:10', detail: 'src/lib', path: true });
        expect(locationRow(here, 'a.ts')).toEqual({ label: 'a.ts:4', detail: '', path: true });
    });
});

describe('going to a definition', () => {
    test('moves the caret to a place in this file', async () => {
        const { editor, language } = await setup(here);
        editor.moveCaret(at(0, 1));
        await language.navigation.go('definition');
        expect(editor.getCaret()).toEqual(at(3, 4));
    });

    test('lists several places under the name and goes to the chosen one', async () => {
        const { editor, language } = await setup([here, there]);
        editor.moveCaret(at(0, 1));
        await language.navigation.go('implementation');
        const view = language.popups.getState().pick!;
        expect(view.title).toBe('Implementations');
        expect(view.groups[0]!.rows.map((row) => row.label)).toEqual(['a.ts:4', 'b.ts:10']);
        editor.press({ key: 'Enter' });
        expect(editor.getCaret()).toEqual(at(3, 4));
    });

    test('follows a Mod+click on a name and leaves other clicks alone', async () => {
        const { editor, language, methods } = await setup(here);
        expect(editor.click({ position: at(0, 1), mod: false, alt: false, shift: false })).toBe(false);
        expect(editor.click({ position: at(0, 1), mod: true, alt: false, shift: true })).toBe(false);
        expect(editor.click({ position: at(1, 1), mod: true, alt: false, shift: false })).toBe(true);
        await settle();
        expect(methods).toEqual(['textDocument/definition']);
        expect(editor.getCaret()).toEqual(at(3, 4));
        expect(language.popups.getState().pick).toBeNull();
    });

    test('takes no click when the file has no server that finds definitions', async () => {
        const { editor } = await setup(here, {});
        expect(editor.click({ position: at(0, 1), mod: true, alt: false, shift: false })).toBe(false);
    });

    test('says so when nothing is found or the language is not served', async () => {
        const none = await setup(null);
        await none.language.navigation.go('definition');
        expect(useToasts.getState().toasts.at(-1)?.title).toBe('Nothing found');
        await none.language.navigation.go('declaration');
        expect(useToasts.getState().toasts.at(-1)?.title).toBe('No language server answers that here');
    });
});

describe('a name that is its own definition', () => {
    test('shows where it is used instead of going nowhere', async () => {
        const transport = new FakeLanguageTransport();
        transport.providers = { 'textDocument/definition': {}, 'textDocument/references': {} };
        const methods: string[] = [];
        transport.answers.set('language.request', (payload: { method: string }) => {
            methods.push(payload.method);
            const result = payload.method === 'textDocument/definition' ? here : [here, there];
            return { result, server: 'typescript', version: 1 };
        });
        const project = new ProjectLanguage(transport, 'p1', '/work/app');
        const editor = new FakeEditorEngine().mount({} as HTMLElement, { text: 'one\ntwo\nthree\nlet value = 1;', theme: 'light' });
        const language = new EditorLanguage(project, editor, uri, 'typescript');
        await language.document.ready;
        editor.click({ position: at(3, 6), mod: true, alt: false, shift: false });
        await settle();
        expect(methods).toEqual(['textDocument/definition', 'textDocument/references']);
        expect(language.popups.getState().peek?.count).toBe(2);
        expect(editor.getCaret()).toEqual(at(0, 0));
    });
});

describe('going to a name in a signature', () => {
    const symbol = (name: string, target: string, line: number, containerName?: string) => ({
        name,
        kind: 5,
        containerName,
        location: { uri: target, range: { start: at(line, 0), end: at(line, 3) } }
    });

    test('goes to the definition the hover knows when the name is the symbol itself, without asking a server', async () => {
        const { editor, language, methods } = await setup(null);
        await language.navigation.goToName('Message', at(0, 0), here);
        expect(methods).toEqual([]);
        expect(editor.getCaret()).toEqual(at(3, 4));
    });

    test('looks any other name up among the symbols, and goes there when one matches', async () => {
        const { editor, language, methods } = await setup([symbol('Bus', uri, 2), symbol('BusFactory', there.uri, 1)], {
            'textDocument/definition': {},
            'workspace/symbol': {}
        });
        await language.navigation.goToName('Bus', at(0, 0), null);
        expect(methods).toEqual(['workspace/symbol']);
        expect(editor.getCaret()).toEqual(at(2, 0));
    });

    test('lists several matches, prefers the namespace the file names, and does nothing for none', async () => {
        const providers = { 'workspace/symbol': {} };
        const several = await setup([symbol('Bus', uri, 2), symbol('Bus', there.uri, 1)], providers);
        await several.language.navigation.goToName('Bus', at(0, 0), null);
        expect(several.language.popups.getState().pick?.groups[0]!.rows).toHaveLength(2);
        const named = await setup([symbol('Bus', uri, 2, 'one'), symbol('Bus', there.uri, 1, 'App')], providers);
        named.editor.type('one\ntwo\nthree\nlet value = 1; // one');
        await named.language.navigation.goToName('Bus', at(0, 0), null);
        expect(named.language.popups.getState().pick).toBeNull();
        expect(named.editor.getCaret()).toEqual(at(2, 0));
        const none = await setup([], providers);
        await none.language.navigation.goToName('Bus', at(0, 0), null);
        expect(none.language.popups.getState().pick).toBeNull();
        expect(useToasts.getState().toasts).toEqual([]);
    });
});
