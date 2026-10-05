import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { FakeEditorEngine } from '@ruimte/smart-editor/fake';
import type { Editor } from '@ruimte/smart-editor';
import { useProvidersStore } from '@ruimte/agents-react/state/providers';
import { CANVAS_SHORTCUTS } from '@/canvas/shortcuts';
import { EditorLanguage } from '@/language/editor-language';
import { FakeLanguageTransport } from '@/language/fake-daemon';
import { eventOf } from '@/language/key-events';
import { LANGUAGE_COMMANDS } from '@/language/command-table';
import { ProjectLanguage } from '@/language/project-language';
import { currentEndpointId } from '@/state/keys';
import { useProject } from '@/state/project';
import { useSettings } from '@/state/settings';
import { useToasts } from '@/state/toasts';
import { InlineEditFeature, inlineAgentNow } from './inline-edit';
import { saveInlineEdit } from './inline-edit-record';
import { forgetInlineSessions, inlineSessionOf } from './inline-edit-session';
import { Harness, RANGE, SELECTED, TEXT, at } from './inline-edit-test-helpers';

const uri = 'file:///work/app/src/score.ts';
const path = '/work/app/src/score.ts';
const BLOCK = '```replacement\n  if (!need.length) return 1;\n  return hits / need.length;\n```';

let harness: Harness;
let transport: FakeLanguageTransport;
let storage: Map<string, string>;

type FakeEditor = ReturnType<FakeEditorEngine['mount']>;

async function open(text = TEXT): Promise<{ editor: FakeEditor; language: EditorLanguage; feature: InlineEditFeature }> {
    const project = new ProjectLanguage(transport, 'p1', '/work/app');
    const editor = new FakeEditorEngine().mount({} as HTMLElement, { text, theme: 'light' });
    const language = new EditorLanguage(project, editor, uri, 'typescript');
    await language.document.ready;
    // The one the language made takes the key and the commands; this one answers to the test's own deps.
    const feature = new InlineEditFeature(language, () => harness.deps);
    return { editor, language, feature };
}

beforeEach(() => {
    harness = new Harness();
    transport = new FakeLanguageTransport();
    storage = new Map();
    Object.defineProperty(globalThis, 'localStorage', {
        configurable: true,
        value: {
            getItem: (key: string) => storage.get(key) ?? null,
            setItem: (key: string, value: string) => void storage.set(key, value),
            removeItem: (key: string) => void storage.delete(key)
        }
    });
    useProject.setState({ current: { projectId: 'p1', folder: '/work/app' } as never });
});

afterEach(() => {
    forgetInlineSessions();
    useProject.setState({ current: null });
    useToasts.getState().toasts.forEach((toast) => useToasts.getState().dismiss(toast.id));
    useProvidersStore.setState({ byScope: {} });
    Reflect.deleteProperty(globalThis, 'localStorage');
});

describe('Mod+I in the editor', () => {
    test('opens the question for the selected lines with the problems on them, and Escape puts it away', async () => {
        const { editor, language } = await open();
        transport.emit('language.diagnostics', {
            projectId: 'p1',
            path: 'src/score.ts',
            server: 'typescript',
            version: 1,
            diagnostics: [
                { range: { start: at(0, 0), end: at(0, 8) }, message: 'above', severity: 1 },
                { range: { start: at(2, 9), end: at(2, 13) }, message: 'on the lines', severity: 1, code: 2345, source: 'ts' }
            ]
        });
        editor.setSelection(RANGE);

        expect(editor.press(eventOf(CANVAS_SHORTCUTS.inlineEdit))).toBe(true);

        const { prompt } = language.inlineEdit.store.getState();
        expect(prompt).toMatchObject({ range: RANGE, selectedText: SELECTED, span: { startLine: 2, endLine: 3 }, instruction: '' });
        expect(prompt?.problems).toEqual([{ line: 3, severity: 'error', message: 'on the lines', code: 'ts(2345)' }]);
        expect(editor.press(eventOf(shortcutOf('Escape')))).toBe(true);
        expect(language.inlineEdit.store.getState().prompt).toBeNull();
    });

    test('takes the line under the caret when nothing is selected', async () => {
        const { editor, language } = await open();
        editor.moveCaret(at(1, 5));

        language.inlineEdit.start();

        expect(language.inlineEdit.store.getState().prompt).toMatchObject({
            range: { start: at(1, 0), end: at(1, 34) },
            selectedText: '  if (need.length === 0) return 1;',
            span: { startLine: 2, endLine: 2 }
        });
    });

    test('is a command of the Code menu and the palette with the key of the editor table, beside Show Inline Edit', () => {
        expect(LANGUAGE_COMMANDS['inline-edit']).toMatchObject({ menu: 'code', key: 'inlineEdit', shortcut: CANVAS_SHORTCUTS.inlineEdit });
        expect(LANGUAGE_COMMANDS['show-inline-edit']).toMatchObject({ menu: 'code', key: 'showInlineEdit' });
    });
});

describe('an edit under the selection', () => {
    test('draws its card in a row of its own under the last selected line, and Apply writes the proposal into the file', async () => {
        const { editor, feature } = await open();
        editor.setSelection(RANGE);
        feature.start();
        feature.setInstruction('simplify the guard');

        feature.run();
        await turnsDone();

        expect(cardsOf(editor)?.map((widget) => [widget.id, widget.line])).toEqual([['card', 2]]);
        expect(feature.store.getState().prompt).toBeNull();
        const session = inlineSessionOf(currentEndpointId(), path)!;
        harness.answer('chat-1', 'turn-1', BLOCK);
        expect(session.store.getState().phase).toBe('proposal');
        expect(editor.getText()).toBe(TEXT);

        expect(await session.apply()).toBe('applied');

        expect(editor.getText()).toContain('  if (!need.length) return 1;');
        expect(cardsOf(editor)).toBeUndefined();
        expect(feature.store.getState().session).toBeNull();
    });

    test('puts the card under the line before when the selection ends at the start of a line', async () => {
        const { editor, feature } = await open();
        editor.setSelection({ start: at(1, 0), end: at(3, 0) });
        feature.start();
        feature.setInstruction('x');

        feature.run();

        expect(cardsOf(editor)?.[0]?.line).toBe(2);
    });

    test('goes when the card is closed, and comes back with Show', async () => {
        const { editor, feature } = await open();
        editor.setSelection(RANGE);
        feature.start();
        feature.setInstruction('x');
        feature.run();
        const session = inlineSessionOf(currentEndpointId(), path)!;
        expect(cardsOf(editor)).toHaveLength(1);

        session.hide();
        expect(cardsOf(editor)).toBeUndefined();

        await feature.show();
        expect(cardsOf(editor)).toHaveLength(1);
    });

    test('goes on without its editor, and the next editor of the file draws it again', async () => {
        const first = await open();
        first.editor.setSelection(RANGE);
        first.feature.start();
        first.feature.setInstruction('x');
        first.feature.run();
        const session = inlineSessionOf(currentEndpointId(), path)!;

        first.language.dispose();
        expect(session.store.getState().attached).toBe(false);
        expect(inlineSessionOf(currentEndpointId(), path)).toBe(session);

        const second = await open();
        expect(session.store.getState()).toMatchObject({ attached: true, shown: true, stale: false });
        expect(second.feature.store.getState().session).toBe(session);
    });

    test('has nothing to show for a file without an edit', async () => {
        const { feature } = await open();

        await feature.show();

        expect(useToasts.getState().toasts.map((toast) => toast.title)).toEqual(['This file has no inline edit to show.']);
    });

    test('shows the edit this client kept before a reload', async () => {
        saveInlineEdit(currentEndpointId(), {
            chatId: 'chat-1',
            viewId: 'chat-1',
            projectId: 'p1',
            path,
            range: RANGE,
            selectedText: SELECTED,
            instruction: 'simplify',
            provider: 'claude',
            model: null,
            createdAt: 10
        });
        const { feature } = await open();
        expect(feature.hasEdit).toBe(true);

        await feature.show();

        expect(feature.store.getState().session?.store.getState()).toMatchObject({ instruction: 'simplify', attached: true });
        expect(harness.calls).toContain('open chat-1');
    });
});

describe('the agent of an inline edit', () => {
    function installed(...kinds: string[]): void {
        useProvidersStore.getState().setProviders(
            'e1',
            kinds.map((kind) => ({ kind, name: kind, installed: true, capabilities: { chat: true }, models: [], defaultModel: 'm' }) as never)
        );
    }

    test('is the one the setting names while it is installed, and the first one that is when it is not', () => {
        useSettings.setState({ aiInlineAgent: { provider: 'codex', model: 'gpt-x' } });
        installed('claude', 'codex');
        expect(inlineAgentNow('e1')).toEqual({ provider: 'codex', model: 'gpt-x' });

        installed('claude');
        expect(inlineAgentNow('e1')).toEqual({ provider: 'claude', model: null });

        installed();
        expect(inlineAgentNow('e1')).toEqual({ provider: 'codex', model: 'gpt-x' });
    });
});

/* The rows the inline edit gave the fake editor, which keeps them by owner. */
function cardsOf(editor: Editor): readonly { id: string; line: number }[] | undefined {
    return (editor as unknown as { widgetsByOwner: Map<string, readonly { id: string; line: number }[]> }).widgetsByOwner.get('inline-edit');
}

function shortcutOf(key: string) {
    return { key, mod: false, ctrl: false, meta: false, alt: false, shift: false } as never;
}

/* Lets the chain of awaits of a started run reach the point where it waits on the agent. */
function turnsDone(): Promise<void> {
    return new Promise((resolve) => setImmediate(resolve));
}
