import { beforeEach, describe, expect, test } from 'bun:test';
import { FakeEditorEngine } from '@adecore/editor/fake';
import { FakeOnDeviceModel } from '@/ondevice/fake-model';
import { CANVAS_SHORTCUTS } from '@/canvas/shortcuts';
import { useSettings } from '@/state/settings';
import { useToasts } from '@/state/toasts';
import { EditorLanguage } from './ruimte-editor-language';
import { FakeLanguageTransport } from './fake-daemon';
import { eventOf } from './key-events';
import { ProjectLanguage } from './ruimte-project-language';
import { ManualTimers } from '@adecore/editor-react/testing';

const uri = 'file:///work/app/src/a.ts';
const at = (line: number, character: number) => ({ line, character });

async function settle(): Promise<void> {
    for (let turn = 0; turn < 60; turn++) {
        await Promise.resolve();
    }
}

const TEXT = 'export function bestMatch(pool: Candidate[]): Candidate | null {\n    \n}\n';

async function setup(options: { available?: boolean; text?: string; caret?: { line: number; character: number } } = {}) {
    const transport = new FakeLanguageTransport();
    const model = new FakeOnDeviceModel(transport, options.available === false ? { available: false, reason: 'Apple Intelligence is turned off.' } : {});
    const project = new ProjectLanguage(transport, 'p1', '/work/app');
    const editor = new FakeEditorEngine().mount({} as HTMLElement, { text: options.text ?? TEXT, theme: 'light' });
    const timers = new ManualTimers();
    const language = new EditorLanguage(project, editor, uri, 'typescript', timers);
    await language.document.ready;
    editor.moveCaret(options.caret ?? at(1, 4));
    const suggest = (): boolean => editor.press(eventOf(CANVAS_SHORTCUTS.suggestInline));
    return { transport, model, editor, language, project, timers, suggest };
}

const key = (name: string, extra: Record<string, boolean> = {}) => ({ key: name, ...extra });

beforeEach(() => {
    useToasts.setState({ toasts: [] });
    useSettings.setState({ aiGhostText: 'request' });
});

describe('ghost text on request', () => {
    test('Option+\\ asks for a continuation with the text on both sides of the caret and shows a hint while it waits', async () => {
        const { model, editor, language, suggest } = await setup();
        expect(suggest()).toBe(true);
        await settle();
        expect(model.last.purpose).toBe('ghost');
        expect(model.last.prompt).toContain('<before>\nexport function bestMatch(pool: Candidate[]): Candidate | null {\n    </before>');
        expect(model.last.prompt).toContain('<after>\n}\n</after>');
        expect(language.ghost.busy).toBe(true);
        expect(editor.lineActionsByOwner.get('ghost-progress')).toHaveLength(1);
        expect(editor.ghost).toBeNull();
    });

    test('draws what comes back after the caret without the lines it wrote again, and takes the hint away', async () => {
        const { model, editor, language } = await setup();
        void language.ghost.request();
        await settle();
        model.answer('export function bestMatch(pool: Candidate[]): Candidate | null {\n    const [first] = rank(pool);\n    return first ?? null;\n}');
        await settle();
        expect(editor.ghost).toMatchObject({ position: at(1, 4), text: 'const [first] = rank(pool);\n    return first ?? null;' });
        expect(editor.lineActionsByOwner.has('ghost-progress')).toBe(false);
        expect(language.ghost.busy).toBe(false);
        expect(language.ghost.active).toBe(true);
    });

    test('Tab takes all of it as one edit and leaves the caret behind it', async () => {
        const { model, editor, language } = await setup();
        void language.ghost.request();
        await settle();
        model.answer('return null;');
        await settle();
        expect(editor.press(key('Tab'))).toBe(true);
        expect(editor.getText()).toBe('export function bestMatch(pool: Candidate[]): Candidate | null {\n    return null;\n}\n');
        expect(editor.getCaret()).toEqual(at(1, 16));
        expect(editor.ghost).toBeNull();
        expect(language.ghost.active).toBe(false);
    });

    test('a suggestion over several lines puts the caret at the end of its last line', async () => {
        const { model, editor, language } = await setup();
        void language.ghost.request();
        await settle();
        model.answer('const a = 1;\n    return a;');
        await settle();
        editor.press(key('Tab'));
        expect(editor.getCaret()).toEqual(at(2, 13));
    });

    test('Option+] takes a word and keeps the rest as the suggestion after it', async () => {
        const { model, editor, language } = await setup();
        void language.ghost.request();
        await settle();
        model.answer('return pool[0];');
        await settle();
        expect(editor.press(eventOf(CANVAS_SHORTCUTS.acceptGhostWord))).toBe(true);
        expect(editor.getText()).toContain('\n    return\n');
        expect(editor.ghost).toMatchObject({ position: at(1, 10), text: ' pool[0];' });
        editor.press(eventOf(CANVAS_SHORTCUTS.acceptGhostWord));
        expect(editor.getText()).toContain('\n    return pool\n');
        expect(editor.ghost?.text).toBe('[0];');
    });

    test('Escape, an edit and a move of the caret all put it away', async () => {
        for (const away of [
            (rig: Awaited<ReturnType<typeof setup>>) => expect(rig.editor.press(key('Escape'))).toBe(true),
            (rig: Awaited<ReturnType<typeof setup>>) => rig.editor.type(`${rig.editor.getText()}x`),
            (rig: Awaited<ReturnType<typeof setup>>) => rig.editor.moveCaret(at(0, 3))
        ]) {
            const rig = await setup();
            void rig.language.ghost.request();
            await settle();
            rig.model.answer('return null;');
            await settle();
            expect(rig.editor.ghost).not.toBeNull();
            away(rig);
            expect(rig.editor.ghost).toBeNull();
            expect(rig.language.ghost.active).toBe(false);
        }
    });

    test("Tab is the editor's own where nothing is suggested", async () => {
        const { editor } = await setup();
        expect(editor.press(key('Tab'))).toBe(false);
    });

    test('Escape while the model works cancels the request, and a late answer shows nothing', async () => {
        const { model, editor, language } = await setup();
        void language.ghost.request();
        await settle();
        expect(editor.press(key('Escape'))).toBe(true);
        await settle();
        expect(model.cancels).toEqual([model.last.id]);
        expect(language.ghost.busy).toBe(false);
        expect(editor.lineActionsByOwner.has('ghost-progress')).toBe(false);
        model.answer('return null;');
        await settle();
        expect(editor.ghost).toBeNull();
    });

    test('drops an answer for text that changed or a caret that moved in the meantime', async () => {
        const first = await setup();
        void first.language.ghost.request();
        await settle();
        first.editor.type(`${first.editor.getText()}// edit`);
        first.model.answer('return null;');
        await settle();
        expect(first.editor.ghost).toBeNull();

        const second = await setup();
        void second.language.ghost.request();
        await settle();
        second.editor.moveCaret(at(2, 0));
        second.model.answer('return null;');
        await settle();
        expect(second.editor.ghost).toBeNull();
    });

    test('with text after the caret on the line only the rest of that line is suggested', async () => {
        const { model, editor, language } = await setup({ text: 'const total = (1 + 2)\nnext();', caret: at(0, 13) });
        void language.ghost.request();
        await settle();
        model.answer('(1 + 2) * 3;\nconsole.log(total);');
        await settle();
        expect(editor.ghost?.text).toBe('(1 + 2) * 3;');
    });

    test('says so when there is nothing to suggest', async () => {
        const { model, editor, language } = await setup();
        void language.ghost.request();
        await settle();
        model.answer('}');
        await settle();
        expect(editor.ghost).toBeNull();
        expect(useToasts.getState().toasts.at(-1)?.title).toBe('No suggestion for this spot');
    });

    test('says why the model is not there and asks for nothing', async () => {
        const { model, language } = await setup({ available: false });
        await language.ghost.request();
        expect(model.requests).toEqual([]);
        expect(useToasts.getState().toasts.at(-1)?.title).toBe('Apple Intelligence is turned off.');
    });

    test('never asks with the setting off, and leaves the key to the editor', async () => {
        useSettings.setState({ aiGhostText: 'off' });
        const { model, language, suggest } = await setup();
        expect(suggest()).toBe(false);
        await language.ghost.request();
        expect(model.requests).toEqual([]);
        expect(useToasts.getState().toasts.at(-1)?.title).toContain('turned off');
    });

    test('never asks while typing, and does nothing over a selection', async () => {
        const { model, editor, language } = await setup();
        editor.type(`${editor.getText()}x`);
        await settle();
        expect(model.requests).toEqual([]);
        editor.setSelection({ start: at(0, 0), end: at(0, 6) });
        await language.ghost.request();
        expect(model.requests).toEqual([]);
    });
});

describe('ghost text with shared completions', () => {
    test('Tab accepts the app suggestion before the language completion menu', async () => {
        const { transport, model, editor, language, project, timers } = await setup();
        try {
            transport.providers = { 'textDocument/completion': {} };
            transport.answers.set('language.request', () => ({
                result: { isIncomplete: false, items: [{ label: 'rank' }, { label: 'reduce' }] },
                server: 'typescript',
                version: 1
            }));
            void language.ghost.request();
            await settle();
            model.answer('return null;');
            await settle();
            language.completion.invoke();
            timers.advance(20);
            await settle();
            expect(language.popups.getState().completion).not.toBeNull();
            expect(language.ghost.active).toBe(true);
            expect(editor.press(key('Tab'))).toBe(true);
            expect(editor.getText()).toContain('return null;');
        } finally {
            language.dispose();
            project.dispose();
        }
    });
});
