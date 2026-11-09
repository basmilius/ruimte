import { beforeEach, describe, expect, test } from 'bun:test';
import { keyOf as eventOf, settle } from '@adecore/editor-react/testing';
import { FakeEditorEngine } from '@adecore/editor/fake';
import { FakeEditorAssistModel } from '@/editor-assist/fake-model';
import { useSettings } from '@/state/settings';
import { useToasts } from '@/state/toasts';
import { keyOf } from '@/surface/shortcut-overrides';
import { FakeLanguageTransport, readOnlyFiles } from './fake-daemon';
import { createEditorLanguage } from './ruimte-editor-language';
import { RuimteProject } from './ruimte-project';

const uri = 'file:///work/app/src/a.ts';
const otherUri = 'file:///work/app/src/b.ts';
const at = (line: number, character: number) => ({ line, character });
const range = (line: number, start: number, end: number) => ({ start: at(line, start), end: at(line, end) });

const TEXT = 'const hits = need.filter((n) => has(n));\nreturn hits.length / need.length;';

async function setup(options: { available?: boolean; fail?: boolean } = {}) {
    const transport = new FakeLanguageTransport();
    transport.providers = { 'textDocument/rename': { prepareProvider: true }, 'textDocument/references': {} };
    const model = new FakeEditorAssistModel(
        transport,
        options.available === false ? { available: false, reason: 'The selected editor model is unavailable.' } : {}
    );
    if (options.fail) {
        transport.answers.set('editor.generate', () => Promise.reject(new Error('model failed')));
    }
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
    const project = new RuimteProject(transport, 'p1', '/work/app', readOnlyFiles({ '/work/app/src/b.ts': 'log(hits);' }));
    const editor = new FakeEditorEngine().mount({} as HTMLElement, { text: TEXT, theme: 'light' });
    const language = createEditorLanguage(project, editor, uri, 'typescript');
    await language.document.ready;
    editor.moveCaret(at(0, 7));
    editor.press(eventOf(keyOf('renameSymbol')!));
    await settle();
    return { transport, model, editor, language };
}

function renameSent(transport: FakeLanguageTransport): boolean {
    return transport.callsOf('language.request').some((call) => (call.payload as { method: string }).method === 'textDocument/rename');
}

beforeEach(() => {
    useToasts.setState({ toasts: [] });
    useSettings.setState({ aiCodeHelp: true });
});

describe('rename suggestions', () => {
    test('asks the model about the lines around the symbol and the lines that use it', async () => {
        const { model } = await setup();
        expect(model.requests).toHaveLength(1);
        expect(model.last.purpose).toBe('names');
        expect(model.last.stream).toBe(false);
        expect(model.last.prompt).toContain('Current name: hits');
        expect(model.last.prompt).toContain(`Code around it:\n${TEXT}\n\nLines that use it:`);
        expect(model.last.prompt).toContain('Lines that use it:\nconst hits = need.filter((n) => has(n));\nreturn hits.length / need.length;\nlog(hits);');
    });

    test('shows the valid names the model gave under the input, and nothing is applied', async () => {
        const { model, language, transport } = await setup();
        model.answer('1. matchedSkills\n2. matches\n3. not a name\n4. class\n5. foundSkills\n6. hits');
        await settle();
        expect(language.popups.slot('rename').get()!.suggestions).toEqual(['matchedSkills', 'matches', 'foundSkills']);
        expect(language.popups.slot('rename').get()!.name).toBe('hits');
        expect(renameSent(transport)).toBe(false);
    });

    test('offers none when the setting is off or the machine has no model', async () => {
        useSettings.setState({ aiCodeHelp: false });
        const off = await setup();
        expect(off.model.requests).toEqual([]);
        expect(off.language.popups.slot('rename').get()!.suggestions).toEqual([]);

        useSettings.setState({ aiCodeHelp: true });
        const missing = await setup({ available: false });
        expect(missing.model.requests).toEqual([]);
    });

    test('drops the answer of a rename that was closed, and cancels the request', async () => {
        const { model, language, transport, editor } = await setup();
        // Records the cancel but lets the answer still arrive afterwards, to prove it is dropped.
        transport.answers.set('editor.cancel', ({ id }: { id: string }) => {
            model.cancels.push(id);
            return {};
        });
        language.rename.cancel();
        await settle();
        expect(model.cancels).toEqual([model.last.id]);
        expect(language.popups.slot('rename').get()).toBeNull();
        model.answer('matchedSkills');
        await settle();
        expect(language.popups.slot('rename').get()).toBeNull();
        expect(editor.getText()).toBe(TEXT);
        expect(renameSent(transport)).toBe(false);
    });

    test('invalid output and a failed model leave the input as it is', async () => {
        const { model, language, editor } = await setup();
        model.answer('!!!');
        await settle();
        expect(language.popups.slot('rename').get()).toMatchObject({ suggestions: [], phase: 'input', name: 'hits' });
        expect(editor.getText()).toBe(TEXT);
        const failed = await setup({ fail: true });
        expect(failed.transport.callsOf('editor.generate')).toHaveLength(1);
        expect(failed.language.popups.slot('rename').get()).toMatchObject({ suggestions: [], phase: 'input', name: 'hits' });
        expect(failed.editor.getText()).toBe(TEXT);
        expect(renameSent(failed.transport)).toBe(false);
    });
});
