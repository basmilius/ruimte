import { beforeEach, describe, expect, test } from 'bun:test';
import { FakeEditorEngine } from '@ruimte/smart-editor/fake';
import type { CompletionItem } from '@ruimte/smart-editor-lsp';
import { EditorLanguage } from './editor-language';
import { FakeLanguageTransport } from './fake-daemon';
import { ProjectLanguage } from './project-language';
import { forgetRecentChoices } from './recent-choices';
import { ManualTimers } from './timers';

const at = (line: number, character: number) => ({ line, character });

async function settle(): Promise<void> {
    for (let turn = 0; turn < 200; turn++) {
        await Promise.resolve();
    }
}

beforeEach(() => forgetRecentChoices());

const SIGNATURE = { signatures: [{ label: 'open(flag: boolean): void', parameters: [{ label: 'flag: boolean' }] }], activeParameter: 0 };

async function setup(text: string, items: CompletionItem[], languageId = 'typescript', resolved?: Partial<CompletionItem>) {
    const transport = new FakeLanguageTransport();
    transport.providers = {
        'textDocument/completion': { triggerCharacters: ['.'] },
        'textDocument/signatureHelp': { triggerCharacters: ['(', ','] },
        ...(resolved === undefined ? {} : { 'completionItem/resolve': { resolveProvider: true } })
    };
    const asked: { method: string; params: { context?: unknown } }[] = [];
    transport.answers.set('language.request', (payload: { method: string; params: { context?: unknown } }) => {
        asked.push(payload);
        const result =
            payload.method === 'textDocument/signatureHelp'
                ? SIGNATURE
                : payload.method === 'completionItem/resolve'
                  ? { ...(payload.params as CompletionItem), ...resolved }
                  : { isIncomplete: false, items };
        return { result, server: 'typescript', version: 1 };
    });
    const commands: unknown[] = [];
    transport.answers.set('language.command', (payload: unknown) => {
        commands.push(payload);
        return { result: null, server: 'typescript' };
    });
    const project = new ProjectLanguage(transport, 'p1', '/work/app');
    const editor = new FakeEditorEngine().mount({} as HTMLElement, { text, theme: 'light' });
    editor.moveCaret(at(0, text.length));
    const timers = new ManualTimers();
    const extension = languageId === 'php' ? 'php' : languageId === 'vue' ? 'vue' : 'ts';
    const language = new EditorLanguage(project, editor, `file:///work/app/src/a.${extension}`, languageId, timers);
    await language.document.ready;
    /* A list of one is taken at once when asked for, so a test that wants a choice gives the list a second row. */
    const accept = async (replace = false): Promise<void> => {
        language.completion.invoke();
        timers.advance(10);
        await settle();
        if (language.completion.isOpen) {
            await language.completion.accept(replace, 0);
        }
        timers.advance(100);
        await settle();
    };
    const signatureRequests = () => asked.filter((entry) => entry.method === 'textDocument/signatureHelp');
    return { editor, language, timers, accept, commands, signatureRequests, card: () => language.popups.getState().signature };
}

const WITH_PARAMETERS: CompletionItem = { label: 'open', kind: 2, detail: '(method) Box.open(flag: boolean): void' };
const WITHOUT_PARAMETERS: CompletionItem = { label: 'close', kind: 2, detail: '(method) Box.close(): void' };

describe('a call added on accepting', () => {
    test('puts the caret inside the parentheses of a method with parameters and opens parameter info as if ( was typed', async () => {
        const { editor, accept, signatureRequests, card } = await setup('box.op', [WITH_PARAMETERS]);
        await accept();
        expect(editor.getText()).toBe('box.open()');
        expect(editor.getCaret()).toEqual(at(0, 9));
        expect(signatureRequests()).toHaveLength(1);
        expect(signatureRequests()[0]!.params.context).toMatchObject({ triggerKind: 2, triggerCharacter: '(' });
        expect(card()?.model.parameterName).toBe('flag');
    });

    test('puts the caret behind the parentheses of a method without parameters and opens no parameter info', async () => {
        const { editor, accept, signatureRequests } = await setup('box.cl', [WITHOUT_PARAMETERS]);
        await accept();
        expect(editor.getText()).toBe('box.close()');
        expect(editor.getCaret()).toEqual(at(0, 11));
        expect(signatureRequests()).toHaveLength(0);
    });

    test('puts the caret inside when the server says nothing about the parameters', async () => {
        const { editor, accept } = await setup('now', [{ label: 'now', kind: 3 }]);
        await accept();
        expect(editor.getText()).toBe('now()');
        expect(editor.getCaret()).toEqual(at(0, 4));
    });

    test('takes the parameters from what the item resolves to', async () => {
        const { editor, accept } = await setup('box.cl', [{ label: 'close', kind: 2 }], 'typescript', { detail: '(method) Box.close(): void' });
        await accept();
        expect(editor.getText()).toBe('box.close()');
        expect(editor.getCaret()).toEqual(at(0, 11));
    });

    test('adds none when a parenthesis follows, and Tab goes inside it', async () => {
        const enter = await setup('box.op(1)', [WITH_PARAMETERS]);
        enter.editor.moveCaret(at(0, 6));
        await enter.accept();
        expect(enter.editor.getText()).toBe('box.open(1)');
        expect(enter.editor.getCaret()).toEqual(at(0, 8));
        expect(enter.signatureRequests()).toHaveLength(0);
        const tab = await setup('box.op(1)', [WITH_PARAMETERS, { label: 'opened', kind: 6 }]);
        tab.editor.moveCaret(at(0, 6));
        await tab.accept(true);
        expect(tab.editor.getText()).toBe('box.open(1)');
        expect(tab.editor.getCaret()).toEqual(at(0, 9));
        expect(tab.signatureRequests()).toHaveLength(1);
    });

    test('adds none in an import specifier', async () => {
        const { editor, accept, signatureRequests } = await setup("import { op } from './box';", [{ label: 'open', kind: 3 }]);
        editor.moveCaret(at(0, 11));
        await accept();
        expect(editor.getText()).toBe("import { open } from './box';");
        expect(signatureRequests()).toHaveLength(0);
    });

    test('adds none after typeof, and adds a call to a class after new', async () => {
        const typeOf = await setup('type T = typeof op', [{ label: 'open', kind: 3 }]);
        await typeOf.accept();
        expect(typeOf.editor.getText()).toBe('type T = typeof open');
        const created = await setup('const box = new Bo', [{ label: 'Box', kind: 7 }]);
        await created.accept();
        expect(created.editor.getText()).toBe('const box = new Box()');
        expect(created.editor.getCaret()).toEqual(at(0, 20));
    });

    test('adds a call at every other caret that has the same word before it', async () => {
        const { editor, language, timers } = await setup('a.op\nb.op', [WITH_PARAMETERS]);
        editor.moveCaret(at(1, 4));
        editor.otherCarets = [at(0, 4)];
        language.completion.invoke();
        timers.advance(10);
        await settle();
        await language.completion.accept(false, 0);
        expect(editor.getText()).toBe('a.open()\nb.open()');
        expect(editor.getCaret()).toEqual(at(1, 7));
    });

    test('puts every caret that got the call inside its parentheses', async () => {
        const { editor, language, timers } = await setup('a.op\nb.op\nc.op', [WITH_PARAMETERS]);
        editor.moveCaret(at(2, 4));
        editor.otherCarets = [at(0, 4), at(1, 4)];
        language.completion.invoke();
        timers.advance(10);
        await settle();
        await language.completion.accept(false, 0);
        expect(editor.getText()).toBe('a.open()\nb.open()\nc.open()');
        expect(editor.getSelections()).toEqual([
            { start: at(0, 7), end: at(0, 7) },
            { start: at(1, 7), end: at(1, 7) },
            { start: at(2, 7), end: at(2, 7) }
        ]);
    });

    test('leaves every caret behind the parentheses of a call without parameters', async () => {
        const { editor, language, timers } = await setup('a.cl\nb.cl\nc.cl', [{ label: 'close', kind: 2, detail: '(method) Box.close(): void' }]);
        editor.moveCaret(at(2, 4));
        editor.otherCarets = [at(0, 4), at(1, 4)];
        language.completion.invoke();
        timers.advance(10);
        await settle();
        await language.completion.accept(false, 0);
        expect(editor.getText()).toBe('a.close()\nb.close()\nc.close()');
        expect(editor.getSelections().map((range) => range.end)).toEqual([at(0, 9), at(1, 9), at(2, 9)]);
    });

    test('adds none when ( commits the item, and the typed parenthesis opens parameter info', async () => {
        const items: CompletionItem[] = [
            { ...WITH_PARAMETERS, commitCharacters: ['('] },
            { label: 'opened', kind: 6 }
        ];
        const { editor, language, timers, signatureRequests } = await setup('box.op', items);
        language.completion.invoke();
        timers.advance(10);
        await settle();
        editor.press({ key: '(' });
        await settle();
        timers.advance(100);
        await settle();
        expect(editor.getText()).toBe('box.open(');
        expect(signatureRequests()).toHaveLength(1);
    });
});

describe('an item that brings its own call', () => {
    test('a Vue call snippet gets no second pair of parentheses, and parameter info opens inside it', async () => {
        const item: CompletionItem = { label: 'open', kind: 2, insertText: 'open(${1:flag})$0', insertTextFormat: 2 };
        const { editor, accept, signatureRequests } = await setup('box.op', [item], 'vue');
        await accept();
        expect(editor.getText()).toBe('box.open(flag)');
        expect(editor.getSelection()).toEqual({ start: at(0, 9), end: at(0, 13) });
        expect(signatureRequests()).toHaveLength(1);
    });

    test('a class member snippet with a body is inserted as it is', async () => {
        const item: CompletionItem = { label: 'open', kind: 2, insertText: 'open(flag: boolean): void {\n    $0\n}', insertTextFormat: 2 };
        const { editor, accept } = await setup('op', [item], 'vue');
        await accept();
        expect(editor.getText()).toBe('open(flag: boolean): void {\n    \n}');
    });

    test('text that holds a call already is left alone', async () => {
        const { editor, accept } = await setup('op', [{ label: 'open', kind: 2, insertText: 'open()' }]);
        await accept();
        expect(editor.getText()).toBe('open()');
    });
});

describe('the command of an item', () => {
    const hints = { title: 'Trigger Parameter Hints', command: 'editor.action.triggerParameterHints' };
    const intelephense = (extra: Partial<CompletionItem> = {}): CompletionItem => ({
        label: 'strlen',
        kind: 3,
        detail: 'int',
        labelDetails: { detail: '($string)' },
        command: hints,
        ...extra
    });

    test('triggerParameterHints opens parameter info, once, and goes to no server', async () => {
        const { editor, accept, commands, signatureRequests } = await setup('<?php strl', [intelephense()], 'php');
        await accept();
        expect(editor.getText()).toBe('<?php strlen()');
        expect(commands).toHaveLength(0);
        expect(signatureRequests()).toHaveLength(1);
    });

    test('triggerParameterHints opens parameter info for a snippet call too', async () => {
        const { editor, accept, commands, signatureRequests } = await setup(
            '<?php strl',
            [intelephense({ insertText: 'strlen(${1:string})', insertTextFormat: 2 })],
            'php'
        );
        await accept();
        expect(editor.getText()).toBe('<?php strlen(string)');
        expect(commands).toHaveLength(0);
        expect(signatureRequests()).toHaveLength(1);
    });

    test('adds none in a PHP use statement', async () => {
        const { editor, accept } = await setup('use function strl', [intelephense()], 'php');
        await accept();
        expect(editor.getText()).toBe('use function strlen');
    });

    test('any other command runs on the server that sent it', async () => {
        const other = { title: 'Import', command: 'intelephense.import', arguments: [1] };
        const { accept, commands } = await setup('<?php strl', [intelephense({ command: other })], 'php');
        await accept();
        expect(commands).toEqual([{ projectId: 'p1', path: 'src/a.php', command: 'intelephense.import', arguments: [1], server: 'typescript' }]);
    });
});
