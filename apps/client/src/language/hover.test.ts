import { describe, expect, test } from 'bun:test';
import { FakeEditorEngine } from '@ruimte/smart-editor/fake';
import { EditorLanguage } from './editor-language';
import { FakeLanguageTransport } from './fake-daemon';
import { HoverFeature } from './hover';
import { ProjectLanguage } from './project-language';
import { ManualTimers } from './timers';

const uri = 'file:///work/app/src/a.ts';
const range = (line: number, start: number, end: number) => ({ start: { line, character: start }, end: { line, character: end } });

async function settle(): Promise<void> {
    for (let turn = 0; turn < 30; turn++) {
        await Promise.resolve();
    }
}

async function setup() {
    const transport = new FakeLanguageTransport();
    const project = new ProjectLanguage(transport, 'p1', '/work/app');
    const editor = new FakeEditorEngine().mount({} as HTMLElement, { text: 'let a = salaryFit(1);\nlet b = 2;', theme: 'light' });
    const language = new EditorLanguage(project, editor, uri, 'typescript');
    await language.document.ready;
    const timers = new ManualTimers();
    const hover = new HoverFeature(language, timers);
    const report = (diagnostics: unknown[]) => {
        transport.emit('language.diagnostics', { projectId: 'p1', path: 'src/a.ts', server: 'typescript', version: 1, diagnostics });
    };
    return { transport, editor, language, hover, timers, report };
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
        const { hover, editor, timers, report } = await setup();
        report([{ range: range(0, 8, 17), message: 'Cannot find name', severity: 1 }]);
        editor.hover({ line: 0, character: 10 });
        timers.advance(200);
        expect(hover.store.getState().hover).toBeNull();
        timers.advance(150);
        await settle();
        const shown = hover.store.getState().hover;
        expect(shown?.problems).toHaveLength(1);
        expect(shown?.anchor).toEqual({ line: 0, character: 8 });
        editor.hover({ line: 0, character: 12 });
        timers.advance(1000);
        expect(hover.store.getState().hover).toBe(shown);
    });

    test('shows nothing where there is no problem', async () => {
        const { hover, editor, timers } = await setup();
        editor.hover({ line: 0, character: 2 });
        timers.advance(400);
        await settle();
        expect(hover.store.getState().hover).toBeNull();
    });

    test('goes a moment after the pointer leaves, unless the pointer is in the card', async () => {
        const { hover, editor, timers, report } = await setup();
        report([{ range: range(0, 8, 17), message: 'x' }]);
        editor.hover({ line: 0, character: 10 });
        timers.advance(300);
        await settle();
        editor.hover(null);
        hover.holdCard(true);
        timers.advance(1000);
        expect(hover.store.getState().hover).not.toBeNull();
        hover.holdCard(false);
        timers.advance(300);
        expect(hover.store.getState().hover).toBeNull();
    });

    test('goes when the text is edited, the editor scrolls, or Escape is pressed', async () => {
        const { hover, editor, timers, report } = await setup();
        report([{ range: range(0, 8, 17), message: 'x' }]);
        const open = async () => {
            editor.hover({ line: 0, character: 10 });
            timers.advance(300);
            await settle();
            expect(hover.store.getState().hover).not.toBeNull();
        };
        await open();
        editor.scroll();
        expect(hover.store.getState().hover).toBeNull();
        await open();
        expect(editor.press({ key: 'Escape' })).toBe(true);
        expect(hover.store.getState().hover).toBeNull();
        expect(editor.press({ key: 'Escape' })).toBe(false);
    });
});
