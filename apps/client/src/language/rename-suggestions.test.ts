import { beforeEach, describe, expect, test } from 'bun:test';
import { FakeEditorEngine } from '@adecore/editor/fake';
import { FakeOnDeviceModel } from '@/ondevice/fake-model';
import { useSettings } from '@/state/settings';
import { useToasts } from '@/state/toasts';
import { CANVAS_SHORTCUTS } from '@/canvas/shortcuts';
import { EditorLanguage } from './ruimte-editor-language';
import { FakeLanguageTransport } from './fake-daemon';
import { eventOf } from './key-events';
import { ProjectLanguage } from './ruimte-project-language';

const uri = 'file:///work/app/src/a.ts';
const otherUri = 'file:///work/app/src/b.ts';
const at = (line: number, character: number) => ({ line, character });
const range = (line: number, start: number, end: number) => ({ start: at(line, start), end: at(line, end) });

async function settle(): Promise<void> {
    for (let turn = 0; turn < 100; turn++) {
        await Promise.resolve();
    }
}

const TEXT = 'const hits = need.filter((n) => has(n));\nreturn hits.length / need.length;';

async function setup(options: { available?: boolean } = {}) {
    const transport = new FakeLanguageTransport();
    transport.providers = { 'textDocument/rename': { prepareProvider: true }, 'textDocument/references': {} };
    const model = new FakeOnDeviceModel(transport, options.available === false ? { available: false, reason: 'Apple Intelligence is turned off.' } : {});
    transport.answers.set('language.request', (payload: { method: string }) => {
        const results: Record<string, unknown> = {
            'textDocument/prepareRename': { range: range(0, 6, 10), placeholder: 'hits' },
            'textDocument/references': [
                { uri, range: range(0, 6, 10) },
                { uri, range: range(1, 7, 11) },
                { uri: otherUri, range: range(0, 4, 8) }
            ]
        };
        return { result: results[payload.method] ?? null, server: 'typescript', version: 1 };
    });
    const project = new ProjectLanguage(transport, 'p1', '/work/app', {
        read: async (path) => (path === '/work/app/src/b.ts' ? { text: 'log(hits);', mtime: 1 } : null),
        stage: () => undefined,
        save: async () => null,
        rename: async () => null
    });
    const editor = new FakeEditorEngine().mount({} as HTMLElement, { text: TEXT, theme: 'light' });
    const language = new EditorLanguage(project, editor, uri, 'typescript');
    await language.document.ready;
    editor.moveCaret(at(0, 7));
    editor.press(eventOf(CANVAS_SHORTCUTS.rename));
    await settle();
    return { transport, model, editor, language };
}

beforeEach(() => {
    useToasts.setState({ toasts: [] });
    useSettings.setState({ aiOnDeviceHelp: true });
});

describe('rename suggestions', () => {
    test('asks the model about the lines around the symbol and the lines that use it', async () => {
        const { model } = await setup();
        expect(model.requests).toHaveLength(1);
        expect(model.last.purpose).toBe('names');
        expect(model.last.stream).toBe(false);
        expect(model.last.prompt).toContain('Current name: hits');
        expect(model.last.prompt).toContain('Lines that use it:\nconst hits = need.filter((n) => has(n));\nreturn hits.length / need.length;\nlog(hits);');
    });

    test('shows the valid names the model gave under the input, and nothing is applied', async () => {
        const { model, language, transport } = await setup();
        model.answer('1. matchedSkills\n2. matches\n3. not a name\n4. class\n5. foundSkills\n6. hits');
        await settle();
        expect(language.popups.getState().rename!.suggestions).toEqual(['matchedSkills', 'matches', 'foundSkills']);
        expect(language.popups.getState().rename!.name).toBe('hits');
        expect(transport.callsOf('language.request').some((call) => (call.payload as { method: string }).method === 'textDocument/rename')).toBe(false);
    });

    test('offers none when the setting is off or the machine has no model', async () => {
        useSettings.setState({ aiOnDeviceHelp: false });
        const off = await setup();
        expect(off.model.requests).toEqual([]);
        expect(off.language.popups.getState().rename!.suggestions).toEqual([]);

        useSettings.setState({ aiOnDeviceHelp: true });
        const missing = await setup({ available: false });
        expect(missing.model.requests).toEqual([]);
    });

    test('drops the answer of a rename that was closed, and cancels the request', async () => {
        const { model, language } = await setup();
        language.rename.cancel();
        await settle();
        expect(model.cancels).toEqual([model.last.id]);
        expect(language.popups.getState().rename).toBeNull();
    });

    test('a model that fails leaves the input as it is', async () => {
        const { model, language, transport } = await setup();
        transport.answers.set('ondevice.cancel', () => ({}));
        model.answer('!!!');
        await settle();
        expect(language.popups.getState().rename).toMatchObject({ suggestions: [], phase: 'input' });
    });
});
