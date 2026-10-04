import { beforeEach, describe, expect, test } from 'bun:test';
import { FakeEditorEngine } from '@ruimte/smart-editor/fake';
import { isApplePlatform } from '@/desktop/bridge';
import { useToasts } from '@/state/toasts';
import { EditorLanguage } from './editor-language';
import { FakeLanguageTransport } from './fake-daemon';
import { ProjectLanguage } from './project-language';
import { ManualTimers } from './timers';

const uri = 'file:///work/app/src/a.ts';
const at = (line: number, character: number) => ({ line, character });
const range = (line: number, start: number, end: number) => ({ start: at(line, start), end: at(line, end) });
const MOD = isApplePlatform() ? { metaKey: true } : { ctrlKey: true };

async function settle(): Promise<void> {
    for (let turn = 0; turn < 100; turn++) {
        await Promise.resolve();
    }
}

const FIX = {
    title: "Change spelling to 'salaryMin'",
    kind: 'quickfix',
    isPreferred: true,
    edit: { changes: { [uri]: [{ range: range(0, 4, 10), newText: 'salaryMin' }] } }
};
const EXTRACT = { title: 'Extract to constant', kind: 'refactor.extract', data: 'extract' };
const ORGANIZE = { title: 'Organize imports', kind: 'source.organizeImports', command: { title: 'Organize', command: 'ts.organize' } };

async function setup(options: { actions?: unknown[]; providers?: Record<string, unknown> } = {}) {
    const transport = new FakeLanguageTransport();
    transport.providers = options.providers ?? { 'textDocument/codeAction': { resolveProvider: true }, 'textDocument/formatting': {} };
    const requests: { method: string; params: Record<string, unknown> }[] = [];
    transport.answers.set('language.request', (payload: { method: string; params: Record<string, unknown> }) => {
        requests.push({ method: payload.method, params: payload.params });
        if (payload.method === 'codeAction/resolve') {
            return {
                result: { ...payload.params, edit: { changes: { [uri]: [{ range: range(0, 0, 3), newText: 'const' }] } } },
                server: 'typescript',
                version: 1
            };
        }
        if (payload.method === 'textDocument/formatting') {
            return { result: [{ range: range(0, 0, 0), newText: '    ' }], server: 'typescript', version: 1 };
        }
        return { result: options.actions ?? [FIX, EXTRACT, ORGANIZE], server: 'typescript', version: 1 };
    });
    transport.answers.set('language.command', () => ({ result: null, server: 'typescript' }));
    const timers = new ManualTimers();
    const project = new ProjectLanguage(transport, 'p1', '/work/app');
    const editor = new FakeEditorEngine().mount({} as HTMLElement, { text: 'let salary = 1;', theme: 'light' });
    const language = new EditorLanguage(project, editor, uri, 'typescript', timers);
    await language.document.ready;
    return { transport, requests, timers, editor, language };
}

beforeEach(() => {
    useToasts.setState({ toasts: [] });
});

describe('the lightbulb', () => {
    test('shows on the caret line when a server offers something to do there, after a pause', async () => {
        const { editor, timers, requests } = await setup();
        editor.moveCaret(at(0, 8));
        expect(editor.gutterAction).toBeNull();
        timers.advance(250);
        await settle();
        expect(editor.gutterAction).toMatchObject({ line: 0 });
        expect(requests[0]).toMatchObject({ method: 'textDocument/codeAction', params: { context: { triggerKind: 2 } } });
        editor.moveCaret(at(0, 9));
        expect(editor.gutterAction).toBeNull();
    });

    test('stays away when all the server has is a source action, and when it offers nothing', async () => {
        const source = await setup({ actions: [ORGANIZE] });
        source.editor.moveCaret(at(0, 3));
        source.timers.advance(250);
        await settle();
        expect(source.editor.gutterAction).toBeNull();
        const none = await setup({ actions: [] });
        none.editor.moveCaret(at(0, 3));
        none.timers.advance(250);
        await settle();
        expect(none.editor.gutterAction).toBeNull();
    });

    test('hands the server the problems at the caret', async () => {
        const { transport, editor, timers, requests } = await setup();
        const diagnostic = { range: range(0, 4, 10), message: 'nope', severity: 1 };
        transport.emit('language.diagnostics', { projectId: 'p1', path: 'src/a.ts', server: 'typescript', version: 1, diagnostics: [diagnostic] });
        editor.moveCaret(at(0, 6));
        timers.advance(250);
        await settle();
        expect(requests.at(-1)?.params).toMatchObject({ range: range(0, 6, 6), context: { diagnostics: [diagnostic] } });
    });
});

describe('the list', () => {
    test('opens under the caret on Mod+. grouped by kind, preferred first, and shows what the active action would change', async () => {
        const { editor, timers, language } = await setup();
        editor.moveCaret(at(0, 8));
        expect(editor.press({ key: '.', code: 'Period', ...MOD })).toBe(true);
        await settle();
        const view = language.popups.getState().pick!;
        expect(view.groups.map((group) => [group.title, group.rows.map((row) => row.label)])).toEqual([
            ['Quick fix', ["Change spelling to 'salaryMin'"]],
            ['Refactor', ['Extract to constant']],
            ['Source', ['Organize imports']]
        ]);
        expect(view.active).toBe(view.groups[0]!.rows[0]!.id);
        timers.advance(120);
        await settle();
        expect(language.popups.getState().pick?.preview).toEqual({ removed: ['let salary = 1;'], added: ['let salaryMin = 1;'], note: null });
        editor.press({ key: 'ArrowDown' });
        timers.advance(120);
        await settle();
        // A refactor has no edit until it is resolved, which the preview asks for.
        expect(language.popups.getState().pick?.preview?.added).toEqual(['const salary = 1;']);
    });

    test('applies the chosen action as one edit and closes on Escape', async () => {
        const { editor, language } = await setup();
        editor.moveCaret(at(0, 8));
        await language.codeActions.open();
        expect(editor.press({ key: 'Escape' })).toBe(true);
        expect(language.popups.getState().pick).toBeNull();
        await language.codeActions.open();
        editor.press({ key: 'Enter' });
        await settle();
        expect(editor.getText()).toBe('let salaryMin = 1;');
        expect(language.popups.getState().pick).toBeNull();
    });

    test('resolves an action that has no edit before it is applied, then runs its command', async () => {
        const { editor, language, requests, transport } = await setup({
            actions: [{ title: 'Extract', kind: 'refactor.extract', data: 'x', command: { title: 'Rename', command: 'ts.rename' } }]
        });
        await language.codeActions.open();
        editor.press({ key: 'Enter' });
        await settle();
        expect(requests.map((request) => request.method)).toContain('codeAction/resolve');
        expect(editor.getText()).toBe('const salary = 1;');
        expect(transport.callsOf('language.command')[0]?.payload).toMatchObject({ command: 'ts.rename' });
    });

    test('tells a person when there is nothing to do, and when the file has no server for it', async () => {
        const empty = await setup({ actions: [] });
        await empty.language.codeActions.open();
        expect(useToasts.getState().toasts[0]?.title).toBe('No code actions here');
        const off = await setup({ providers: {} });
        await off.language.codeActions.open();
        expect(useToasts.getState().toasts.at(-1)?.title).toBe('No language server offers code actions here');
    });

    test('asks only for the quick fixes of a problem, at its range', async () => {
        const { language, requests } = await setup();
        const diagnostic = { range: range(0, 4, 10), message: 'nope', severity: 1 as const };
        await language.codeActions.quickFixFor({ diagnostic, server: 'typescript' });
        expect(requests.at(-1)?.params).toMatchObject({ range: diagnostic.range, context: { only: ['quickfix'], diagnostics: [diagnostic], triggerKind: 1 } });
        expect(language.popups.getState().pick?.groups).toHaveLength(1);
    });
});

describe('the commands', () => {
    test('organizes imports through the server action of that kind', async () => {
        const { language, requests, transport } = await setup();
        await language.codeActions.organizeImports();
        expect(requests[0]?.params).toMatchObject({ context: { only: ['source.organizeImports'] } });
        expect(transport.callsOf('language.command')[0]?.payload).toMatchObject({ command: 'ts.organize' });
    });

    test('says so when there is nothing to organize', async () => {
        const { language } = await setup({ actions: [] });
        await language.codeActions.organizeImports();
        expect(useToasts.getState().toasts[0]?.title).toBe('The imports are already organized');
    });

    test('formats the document with the editor indentation as one edit', async () => {
        const { language, editor, requests } = await setup();
        await language.codeActions.formatDocument();
        expect(requests[0]).toMatchObject({ method: 'textDocument/formatting', params: { options: { tabSize: 4, insertSpaces: true } } });
        expect(editor.getText()).toBe('    let salary = 1;');
    });
});
