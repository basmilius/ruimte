import { describe, expect, test } from 'bun:test';
import { FakeEditorEngine } from '@ruimte/smart-editor/fake';
import { EditorLanguage } from './editor-language';
import { FakeLanguageTransport } from './fake-daemon';
import { ProjectLanguage } from './project-language';
import { ManualTimers } from './timers';
import { isApplePlatform } from '@/desktop/bridge';
import { useToasts } from '@/state/toasts';

const uri = 'file:///work/app/src/a.ts';
const range = (line: number, start: number, end: number) => ({ start: { line, character: start }, end: { line, character: end } });

async function settle(): Promise<void> {
    for (let turn = 0; turn < 30; turn++) {
        await Promise.resolve();
    }
}

async function setup(providers: Record<string, unknown> = {}) {
    const transport = new FakeLanguageTransport();
    transport.providers = providers;
    const project = new ProjectLanguage(transport, 'p1', '/work/app');
    const editor = new FakeEditorEngine().mount({} as HTMLElement, { text: 'let a = salaryFit(1);\nlet b = 2;', theme: 'light' });
    const timers = new ManualTimers();
    const language = new EditorLanguage(project, editor, uri, 'typescript', timers);
    await language.document.ready;
    const hover = language.hover;
    const report = (diagnostics: unknown[]) => {
        transport.emit('language.diagnostics', { projectId: 'p1', path: 'src/a.ts', server: 'typescript', version: 1, diagnostics });
    };
    return { transport, editor, language, hover, timers, report, project };
}

describe('diagnostics', () => {
    test('draw a marker per problem and say what is under a position', async () => {
        const { editor, language, report } = await setup();
        report([{ range: range(0, 8, 17), message: 'Cannot find name', severity: 1, source: 'ts', code: 2304 }]);
        expect(editor.markers).toHaveLength(1);
        expect(language.diagnostics.at({ line: 0, character: 10 })[0]!.diagnostic.message).toBe('Cannot find name');
        expect(language.diagnostics.counts()).toEqual({ error: 1, warning: 0, info: 0 });
    });

    test('follow their text when it is edited before the server reports again', async () => {
        const { editor, language, report } = await setup();
        report([{ range: range(0, 8, 17), message: 'x', severity: 2 }]);
        editor.type('// note\nlet a = salaryFit(1);\nlet b = 2;');
        expect(language.diagnostics.problems[0]!.diagnostic.range).toEqual(range(1, 8, 17));
    });

    test('a new report from a server replaces its earlier one', async () => {
        const { language, report } = await setup();
        report([{ range: range(0, 0, 1), message: 'one' }]);
        report([]);
        expect(language.diagnostics.problems).toHaveLength(0);
    });

    test('step to the next problem and wrap', async () => {
        const { editor, language, report } = await setup();
        report([
            { range: range(0, 8, 17), message: 'a' },
            { range: range(1, 4, 5), message: 'b' }
        ]);
        language.diagnostics.step(1);
        expect(editor.getCaret()).toEqual({ line: 0, character: 8 });
        language.diagnostics.step(1);
        expect(editor.getCaret()).toEqual({ line: 1, character: 4 });
        language.diagnostics.step(1);
        expect(editor.getCaret()).toEqual({ line: 0, character: 8 });
    });
});

describe('hover card', () => {
    test('opens after the pointer rests on a problem, and stays while it moves along the word', async () => {
        const { language, editor, timers, report } = await setup();
        report([{ range: range(0, 8, 17), message: 'Cannot find name', severity: 1 }]);
        editor.hover({ line: 0, character: 10 });
        timers.advance(200);
        expect(language.popups.getState().hover).toBeNull();
        timers.advance(150);
        await settle();
        const shown = language.popups.getState().hover;
        expect(shown?.problems).toHaveLength(1);
        expect(shown?.anchor).toEqual({ line: 0, character: 8 });
        editor.hover({ line: 0, character: 12 });
        timers.advance(1000);
        expect(language.popups.getState().hover).toBe(shown);
    });

    test('shows nothing where there is no problem', async () => {
        const { language, editor, timers } = await setup();
        editor.hover({ line: 0, character: 2 });
        timers.advance(400);
        await settle();
        expect(language.popups.getState().hover).toBeNull();
    });

    test('goes a moment after the pointer leaves, unless the pointer is in the card', async () => {
        const { hover, language, editor, timers, report } = await setup();
        report([{ range: range(0, 8, 17), message: 'x' }]);
        editor.hover({ line: 0, character: 10 });
        timers.advance(300);
        await settle();
        editor.hover(null);
        hover.holdCard(true);
        timers.advance(1000);
        expect(language.popups.getState().hover).not.toBeNull();
        hover.holdCard(false);
        timers.advance(300);
        expect(language.popups.getState().hover).toBeNull();
    });

    test('goes when the text is edited, the editor scrolls, or Escape is pressed', async () => {
        const { language, editor, timers, report } = await setup();
        report([{ range: range(0, 8, 17), message: 'x' }]);
        const open = async () => {
            editor.hover({ line: 0, character: 10 });
            timers.advance(300);
            await settle();
            expect(language.popups.getState().hover).not.toBeNull();
        };
        await open();
        editor.scroll();
        expect(language.popups.getState().hover).toBeNull();
        await open();
        expect(editor.press({ key: 'Escape' })).toBe(true);
        expect(language.popups.getState().hover).toBeNull();
        expect(editor.press({ key: 'Escape' })).toBe(false);
    });
});

describe('the reference count', () => {
    async function counted() {
        const mounted = await setup({ 'textDocument/hover': {}, 'textDocument/references': {} });
        let asked = 0;
        mounted.transport.answers.set('language.request', (payload: { method: string }) => {
            if (payload.method === 'textDocument/references') {
                asked++;
            }
            const result =
                payload.method === 'textDocument/hover'
                    ? { contents: { kind: 'markdown', value: '```typescript\nfunction salaryFit(): number\n```' }, range: range(0, 8, 17) }
                    : [{ uri, range: range(0, 8, 17) }];
            return { result, server: 'typescript', version: 1 };
        });
        return { ...mounted, asked: () => asked };
    }

    test('is not asked for while the pointer only passes over a name', async () => {
        const { editor, timers, asked } = await counted();
        editor.hover({ line: 0, character: 10 });
        timers.advance(300);
        await settle();
        editor.hover(null);
        timers.advance(300);
        await settle();
        timers.advance(1000);
        await settle();
        expect(asked()).toBe(0);
    });

    test('is asked for once per name until the text changes', async () => {
        const { editor, timers, asked, language } = await counted();
        const rest = async (character: number) => {
            editor.hover({ line: 0, character });
            timers.advance(300);
            await settle();
            timers.advance(500);
            await settle();
        };
        await rest(10);
        expect(asked()).toBe(1);
        editor.hover(null);
        timers.advance(300);
        await rest(11);
        expect(asked()).toBe(1);
        expect(language.popups.getState().hover?.info?.references).toBe(1);
        editor.type('let a = salaryFit(1);\nlet b = 3;');
        await rest(10);
        expect(asked()).toBe(2);
    });
});

describe('quick info', () => {
    const MOD = isApplePlatform() ? { metaKey: true } : { ctrlKey: true };

    test('opens the card at the caret on Mod+J, survives a scroll and goes on Escape or when the caret moves', async () => {
        const { language, editor, report, transport } = await setup({ 'textDocument/hover': {} });
        transport.answers.set('language.request', () => ({
            result: { contents: { kind: 'markdown', value: '```typescript\nfunction salaryFit(): number\n```' } },
            server: 'typescript',
            version: 1
        }));
        report([{ range: range(0, 8, 17), message: 'Cannot find name', severity: 1 }]);
        editor.moveCaret({ line: 0, character: 10 });
        expect(editor.press({ key: 'j', code: 'KeyJ', ...MOD })).toBe(true);
        await settle();
        expect(language.popups.getState().hover?.problems).toHaveLength(1);
        expect(language.popups.getState().hover?.info?.text.signatures[0]?.code).toBe('function salaryFit(): number');
        editor.scroll();
        expect(language.popups.getState().hover).not.toBeNull();
        editor.press({ key: 'Escape' });
        expect(language.popups.getState().hover).toBeNull();
        editor.press({ key: 'j', code: 'KeyJ', ...MOD });
        await settle();
        expect(language.popups.getState().hover).not.toBeNull();
        editor.moveCaret({ line: 1, character: 0 });
        expect(language.popups.getState().hover).toBeNull();
    });

    test('tells when there is nothing to say at the caret', async () => {
        const { language, editor, transport } = await setup({ 'textDocument/hover': {} });
        transport.answers.set('language.request', () => ({ result: null, server: 'typescript', version: 1 }));
        editor.moveCaret({ line: 1, character: 0 });
        editor.press({ key: 'j', code: 'KeyJ', ...MOD });
        await settle();
        expect(language.popups.getState().hover).toBeNull();
        expect(useToasts.getState().toasts.some((toast) => toast.id === 'language-hover')).toBe(true);
    });
});

describe('hover information', () => {
    test('shows the signature, the documentation and the definition the servers give for the symbol', async () => {
        const { transport, language, editor, timers } = await setup({ 'textDocument/hover': {}, 'textDocument/definition': {} });
        const asked: string[] = [];
        transport.answers.set('language.request', (payload: { method: string }) => {
            asked.push(payload.method);
            const result =
                payload.method === 'textDocument/hover'
                    ? {
                          contents: { kind: 'markdown', value: '```typescript\nfunction salaryFit(): number\n```\n---\nHow well it fits.' },
                          range: range(0, 8, 17)
                      }
                    : [{ uri: 'file:///work/app/src/b.ts', range: range(3, 0, 9) }];
            return { result, server: 'typescript', version: 1 };
        });
        editor.hover({ line: 0, character: 10 });
        timers.advance(300);
        await settle();
        const shown = language.popups.getState().hover;
        expect(asked.sort()).toEqual(['textDocument/definition', 'textDocument/hover']);
        expect(shown?.info?.text.signatures[0]).toEqual({ language: 'typescript', code: 'function salaryFit(): number' });
        expect(shown?.info?.text.markdown).toBe('How well it fits.');
        expect(shown?.info?.definition?.uri).toBe('file:///work/app/src/b.ts');
        expect(shown?.subject).toEqual(range(0, 8, 17));
        expect(shown?.anchor).toEqual({ line: 0, character: 8 });
    });

    test('counts the references after the card is up, and says which word the pointer is on', async () => {
        const { transport, language, editor, timers } = await setup({ 'textDocument/hover': {}, 'textDocument/references': {} });
        transport.answers.set('language.request', (payload: { method: string }) => {
            const result =
                payload.method === 'textDocument/hover'
                    ? { contents: { kind: 'markdown', value: '```typescript\nfunction salaryFit(): number\n```' }, range: range(0, 8, 17) }
                    : [
                          { uri, range: range(0, 8, 17) },
                          { uri, range: range(1, 0, 3) }
                      ];
            return { result, server: 'typescript', version: 1 };
        });
        editor.hover({ line: 0, character: 10 });
        timers.advance(300);
        await settle();
        expect(language.popups.getState().hover?.info).toMatchObject({ word: 'salaryFit', references: null });
        timers.advance(500);
        await settle();
        expect(language.popups.getState().hover?.info).toMatchObject({ word: 'salaryFit', references: 2 });
        expect(language.popups.getState().hover?.position).toEqual({ line: 0, character: 10 });
    });
});
