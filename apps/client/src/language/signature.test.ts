import { describe, expect, test } from 'bun:test';
import { FakeEditorEngine } from '@ruimte/smart-editor/fake';
import { EditorLanguage } from './editor-language';
import { FakeLanguageTransport } from './fake-daemon';
import { ProjectLanguage } from './project-language';
import { ManualTimers } from './timers';
import { CANVAS_SHORTCUTS } from '@/canvas/shortcuts';
import { eventOf } from './key-events';

const uri = 'file:///work/app/src/a.ts';

async function settle(): Promise<void> {
    for (let turn = 0; turn < 100; turn++) {
        await Promise.resolve();
    }
}

const OVERLOADS = [
    { label: 'score(candidate: Candidate): number', parameters: [{ label: 'candidate: Candidate' }] },
    { label: 'score(candidate: Candidate, vacancy: Vacancy): number', parameters: [{ label: 'candidate: Candidate' }, { label: 'vacancy: Vacancy' }] },
    { label: 'score(id: number): number', parameters: [{ label: 'id: number' }] }
];

async function setup(
    signatures: unknown[] = [
        {
            label: 'score(candidate: Candidate, vacancy: Vacancy): number',
            parameters: [{ label: 'candidate: Candidate' }, { label: 'vacancy: Vacancy' }]
        }
    ]
) {
    const transport = new FakeLanguageTransport();
    transport.providers = { 'textDocument/signatureHelp': { triggerCharacters: ['(', ','], retriggerCharacters: [')'] } };
    const contexts: unknown[] = [];
    let active = 0;
    transport.answers.set('language.request', (payload: { params: { context: unknown } }) => {
        contexts.push(payload.params.context);
        const help =
            active < 0
                ? null
                : {
                      signatures,
                      activeParameter: active
                  };
        return { result: help, server: 'typescript', version: 1 };
    });
    const timers = new ManualTimers();
    const project = new ProjectLanguage(transport, 'p1', '/work/app');
    const editor = new FakeEditorEngine().mount({} as HTMLElement, { text: 'score', theme: 'light' });
    const language = new EditorLanguage(project, editor, uri, 'typescript', timers);
    await language.document.ready;
    return { editor, timers, contexts, view: () => language.popups.getState().signature, setActive: (next: number) => (active = next) };
}

describe('overloads', () => {
    test('Up and Down show the next and the previous one while the card is up, and go round', async () => {
        const { editor, timers, view } = await setup(OVERLOADS);
        editor.type('score(');
        timers.advance(100);
        await settle();
        expect(view()?.model).toMatchObject({ index: 0, count: 3, label: OVERLOADS[0]!.label });
        expect(editor.press({ key: 'ArrowDown' })).toBe(true);
        expect(view()?.model).toMatchObject({ index: 1, label: OVERLOADS[1]!.label });
        editor.press({ key: 'ArrowDown' });
        editor.press({ key: 'ArrowDown' });
        expect(view()?.model.index).toBe(0);
        editor.press({ key: 'ArrowUp' });
        expect(view()?.model.index).toBe(2);
        expect(editor.press({ key: 'ArrowDown', shiftKey: true })).toBe(false);
    });

    test('leave the arrows to the caret when there is one signature or no card', async () => {
        const single = await setup();
        single.editor.type('score(');
        single.timers.advance(100);
        await settle();
        expect(single.editor.press({ key: 'ArrowDown' })).toBe(false);
        const none = await setup(OVERLOADS);
        expect(none.editor.press({ key: 'ArrowUp' })).toBe(false);
    });

    test('the overload picked stays picked when the server is asked again as the call is typed', async () => {
        const { editor, timers, view, contexts } = await setup(OVERLOADS);
        editor.type('score(');
        timers.advance(100);
        await settle();
        editor.press({ key: 'ArrowDown' });
        editor.type('score(a');
        timers.advance(100);
        await settle();
        expect(contexts.at(-1)).toMatchObject({ activeSignatureHelp: { activeSignature: 1 } });
        expect(view()).not.toBeNull();
    });

    test('Ctrl+Shift+Space asks for the parameters of the call at the caret', async () => {
        const { editor, timers, view, contexts } = await setup(OVERLOADS);
        editor.type('score(');
        timers.advance(100);
        await settle();
        editor.press({ key: 'Escape' });
        expect(editor.press(eventOf(CANVAS_SHORTCUTS.parameterInfo))).toBe(true);
        timers.advance(100);
        await settle();
        expect(view()).not.toBeNull();
        expect(contexts.at(-1)).toEqual({ triggerKind: 1, isRetrigger: false });
    });
});

describe('signature help', () => {
    test('opens on a trigger character and follows the argument the caret is in', async () => {
        const { editor, timers, view, contexts, setActive } = await setup();
        editor.type('score(');
        timers.advance(100);
        await settle();
        expect(view()?.model).toMatchObject({ active: { start: 6, end: 26 }, parameterName: 'candidate' });
        expect(contexts[0]).toEqual({ triggerKind: 2, triggerCharacter: '(', isRetrigger: false });
        const anchor = view()!.anchor;
        setActive(1);
        editor.type('score(a');
        editor.type('score(a,');
        timers.advance(100);
        await settle();
        expect(view()?.model.parameterName).toBe('vacancy');
        expect(view()?.anchor).toEqual(anchor);
        expect(contexts.at(-1)).toMatchObject({ isRetrigger: true, triggerCharacter: ',' });
    });

    test('goes when the server has nothing for the caret, and on Escape', async () => {
        const { editor, timers, view, setActive } = await setup();
        editor.type('score(');
        timers.advance(100);
        await settle();
        setActive(-1);
        editor.type('score()');
        timers.advance(100);
        await settle();
        expect(view()).toBeNull();
        setActive(0);
        editor.setText('score');
        editor.type('score(');
        timers.advance(100);
        await settle();
        expect(editor.press({ key: 'Escape' })).toBe(true);
        expect(view()).toBeNull();
        expect(editor.press({ key: 'Escape' })).toBe(false);
    });

    test('stays shut for text that is not a trigger', async () => {
        const { editor, timers, view } = await setup();
        editor.type('scores');
        timers.advance(100);
        await settle();
        expect(view()).toBeNull();
    });
});
