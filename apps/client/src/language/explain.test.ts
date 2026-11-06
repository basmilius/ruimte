import { beforeEach, describe, expect, test } from 'bun:test';
import type { HoverInfo } from '@adecore/editor-react';
import { FakeEditorEngine } from '@adecore/editor/fake';
import { FakeEditorAssistModel } from '@/editor-assist/fake-model';
import { useSettings } from '@/state/settings';
import { useToasts } from '@/state/toasts';
import { TransportError } from '@/transport-api/transport';
import { innermostFunction } from './explain';
import { FakeLanguageTransport } from './fake-daemon';
import { createEditorLanguage, type EditorLanguage } from './ruimte-editor-language';
import { RuimteProject } from './ruimte-project';
import { settleLanguage as settle } from './settle.test';

const uri = 'file:///work/app/src/a.ts';
const at = (line: number, character: number) => ({ line, character });
const range = (line: number, start: number, end: number) => ({ start: at(line, start), end: at(line, end) });
const lines = (first: number, last: number) => ({ start: at(first, 0), end: at(last, 1) });

const TEXT = 'function skillOverlap(have: string[], need: string[]): number {\n    return need.length === 0 ? 1 : 0;\n}\nconst share = skillOverlap([], []);';

async function setup(options: { available?: boolean; symbols?: unknown } = {}) {
    const transport = new FakeLanguageTransport();
    transport.providers = { 'textDocument/documentSymbol': {} };
    const model = new FakeEditorAssistModel(
        transport,
        options.available === false ? { available: false, reason: 'The selected editor model is unavailable.' } : {}
    );
    transport.answers.set('language.request', (payload: { method: string }) => ({
        result: payload.method === 'textDocument/documentSymbol' ? (options.symbols ?? null) : null,
        server: 'typescript',
        version: 1
    }));
    const project = new RuimteProject(transport, 'p1', '/work/app');
    const editor = new FakeEditorEngine().mount({} as HTMLElement, { text: TEXT, theme: 'light' });
    const language = createEditorLanguage(project, editor, uri, 'typescript');
    await language.document.ready;
    return { transport, model, editor, language };
}

function infoOf(signature: string): HoverInfo {
    return {
        text: { signatures: [{ language: 'typescript', code: signature }], markdown: 'Share of required skills the candidate has.' },
        definition: { uri, range: range(0, 9, 21) },
        word: 'skillOverlap',
        references: null
    };
}

function showCard(language: EditorLanguage, info: HoverInfo | null): void {
    language.popups.slot('hover').set({ anchor: at(3, 14), position: at(3, 14), subject: range(3, 14, 26), problems: [], info });
}

beforeEach(() => {
    useToasts.setState({ toasts: [] });
    useSettings.setState({ aiCodeHelp: true });
});

describe('explain in the hover card', () => {
    test('offers Explain on a function once the machine says it has the model', async () => {
        const { language } = await setup();
        showCard(language, infoOf('function skillOverlap(have: string[], need: string[]): number'));
        expect(language.app.explain.store.getState().offered).toBe(false);
        await settle();
        expect(language.app.explain.store.getState()).toMatchObject({ offered: true, phase: 'idle' });
    });

    test('offers nothing for a value, with the setting off, or on a machine without the model', async () => {
        const plain = await setup();
        showCard(plain.language, infoOf('const share: number'));
        await settle();
        expect(plain.language.app.explain.store.getState().offered).toBe(false);

        useSettings.setState({ aiCodeHelp: false });
        const off = await setup();
        showCard(off.language, infoOf('function f(): void'));
        await settle();
        expect(off.language.app.explain.store.getState().offered).toBe(false);
        expect(off.transport.callsOf('editor.status')).toHaveLength(0);

        useSettings.setState({ aiCodeHelp: true });
        const missing = await setup({ available: false });
        showCard(missing.language, infoOf('function f(): void'));
        await settle();
        expect(missing.language.app.explain.store.getState().offered).toBe(false);
    });

    test('streams the explanation into the card, from the function source and its signature and documentation', async () => {
        const { language, model } = await setup();
        showCard(language, infoOf('function skillOverlap(have: string[], need: string[]): number'));
        await settle();
        const running = language.app.explain.explainCard();
        await settle();
        expect(language.app.explain.store.getState()).toMatchObject({ offered: false, phase: 'running', text: '' });
        expect(model.last.purpose).toBe('explain');
        expect(model.last.stream).toBe(true);
        expect(model.last.prompt).toContain('Answer in English.');
        expect(model.last.prompt).toContain('Signature: function skillOverlap(have: string[], need: string[]): number');
        expect(model.last.prompt).toContain('Documentation: Share of required skills');
        expect(model.last.prompt).toContain('return need.length === 0 ? 1 : 0;');
        expect(model.last.prompt).not.toContain('const share');
        model.stream('Returns the share');
        expect(language.app.explain.store.getState().text).toBe('Returns the share');
        model.answer('Returns the share of skills.\n');
        await running;
        expect(language.app.explain.store.getState()).toMatchObject({ phase: 'done', text: 'Returns the share of skills.' });
    });

    test('keeps the card up while it explains', async () => {
        const { language } = await setup();
        showCard(language, infoOf('function f(): void'));
        await settle();
        void language.app.explain.explainCard();
        await settle();
        language.hover.holdCard(false);
        expect(language.popups.slot('hover').get()).not.toBeNull();
        language.hover.hide();
        expect(language.popups.slot('hover').get()).toBeNull();
    });

    test('cancels the request when the card goes, and forgets the explanation', async () => {
        const { language, model } = await setup();
        showCard(language, infoOf('function f(): void'));
        await settle();
        void language.app.explain.explainCard();
        await settle();
        language.popups.slot('hover').set(null);
        await settle();
        expect(model.cancels).toEqual([model.last.id]);
        expect(language.app.explain.store.getState()).toMatchObject({ phase: 'idle', text: '', offered: false });
    });

    test('says why when the model fails', async () => {
        const { language, transport } = await setup();
        transport.answers.set('editor.generate', () => {
            throw new TransportError('failed', 'The editor model could not answer.');
        });
        showCard(language, infoOf('function f(): void'));
        await settle();
        await language.app.explain.explainCard();
        expect(language.app.explain.store.getState()).toMatchObject({ phase: 'error', error: 'The editor model could not answer.' });
    });
});

describe('explain the selection', () => {
    test('opens a card of its own over the selection and explains exactly that text', async () => {
        const { language, editor, model } = await setup();
        editor.setSelection(range(1, 4, 37));
        void language.app.explain.explainHere();
        await settle();
        const hover = language.popups.slot('hover').get()!;
        expect(hover.info).toBeNull();
        expect(hover.subject).toEqual(range(1, 4, 37));
        expect(model.last.prompt.startsWith('Explain this code.')).toBe(true);
        expect(model.last.prompt.endsWith('Code:\nreturn need.length === 0 ? 1 : 0;')).toBe(true);
        model.answer('Returns one for an empty list.');
        await settle();
        expect(language.app.explain.store.getState()).toMatchObject({ phase: 'done', text: 'Returns one for an empty list.' });
    });

    test('without a selection explains the function around the caret', async () => {
        const symbols = [{ name: 'skillOverlap', kind: 12, range: lines(0, 2), selectionRange: range(0, 9, 21) }];
        const { language, editor, model } = await setup({ symbols });
        editor.moveCaret(at(1, 6));
        void language.app.explain.explainHere();
        await settle();
        expect(language.popups.slot('hover').get()!.subject).toEqual(lines(0, 2));
        expect(model.last.prompt).toContain('function skillOverlap(have: string[], need: string[]): number {');
    });

    test('says there is nothing to explain without a selection or a function', async () => {
        const { language, editor, model } = await setup();
        editor.moveCaret(at(3, 3));
        await language.app.explain.explainHere();
        expect(model.requests).toEqual([]);
        expect(useToasts.getState().toasts.at(-1)?.title).toContain('Select code');
    });

    test('says where to turn it on when the setting is off', async () => {
        useSettings.setState({ aiCodeHelp: false });
        const { language, model } = await setup();
        await language.app.explain.explainHere();
        expect(model.requests).toEqual([]);
        expect(useToasts.getState().toasts.at(-1)?.title).toContain('Explain is off');
    });
});

describe('innermostFunction', () => {
    test('takes the innermost method or function around a line and never a block or a variable', () => {
        const symbols = [
            {
                kind: 5,
                range: lines(0, 20),
                children: [
                    {
                        kind: 6,
                        range: lines(2, 10),
                        children: [
                            { kind: 13, range: lines(4, 4) },
                            { kind: 12, range: lines(6, 8) }
                        ]
                    },
                    { kind: 6, range: lines(12, 18) }
                ]
            }
        ];
        expect(innermostFunction(symbols, 7)).toEqual(lines(6, 8));
        expect(innermostFunction(symbols, 4)).toEqual(lines(2, 10));
        expect(innermostFunction(symbols, 11)).toBeNull();
        expect(innermostFunction(null, 1)).toBeNull();
    });
});
