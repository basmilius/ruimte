import { describe, expect, test } from 'bun:test';
import { FakeEditorEngine } from '@ruimte/smart-editor/fake';
import { EditorLanguage } from './editor-language';
import { FakeLanguageTransport } from './fake-daemon';
import { editorHighlightsOf, neighborRange } from './highlights';
import { ProjectLanguage } from './project-language';
import { ManualTimers } from './timers';
import { CANVAS_SHORTCUTS } from '@/canvas/shortcuts';
import { eventOf } from './key-events';

const uri = 'file:///work/app/src/a.ts';
const at = (line: number, character: number) => ({ line, character });
const range = (line: number, start: number, end: number) => ({ start: at(line, start), end: at(line, end) });

async function settle(): Promise<void> {
    for (let turn = 0; turn < 100; turn++) {
        await Promise.resolve();
    }
}

describe('highlights', () => {
    async function setup() {
        const transport = new FakeLanguageTransport();
        transport.providers = { 'textDocument/documentHighlight': {} };
        let calls = 0;
        transport.answers.set('language.request', () => {
            calls++;
            return {
                result: [
                    { range: range(0, 4, 9), kind: 3 },
                    { range: range(1, 0, 5), kind: 2 },
                    { range: range(2, 6, 11), kind: 2 }
                ],
                server: 'typescript',
                version: 1
            };
        });
        const timers = new ManualTimers();
        const project = new ProjectLanguage(transport, 'p1', '/work/app');
        const editor = new FakeEditorEngine().mount({} as HTMLElement, { text: 'let value = 1;\nvalue + 1;\nfoo(value);', theme: 'light' });
        const language = new EditorLanguage(project, editor, uri, 'typescript', timers);
        await language.document.ready;
        return { editor, timers, language, calls: () => calls };
    }

    test('marks the uses of the name the caret rests on, with writes apart', async () => {
        const { editor, timers } = await setup();
        editor.moveCaret(at(0, 6));
        timers.advance(200);
        await settle();
        expect(editor.highlights.map((highlight) => highlight.kind)).toEqual(['write', 'read', 'read']);
    });

    test('asks for nothing where the caret is not on a name, and drops the marks when it leaves the name', async () => {
        const { editor, timers, calls } = await setup();
        editor.moveCaret(at(0, 10));
        timers.advance(200);
        await settle();
        expect(calls()).toBe(0);
        editor.moveCaret(at(0, 6));
        timers.advance(200);
        await settle();
        editor.moveCaret(at(1, 2));
        expect(editor.highlights).toHaveLength(3);
        editor.moveCaret(at(0, 12));
        expect(editor.highlights).toHaveLength(0);
    });

    test('steps to the next use with Alt+F3 and back with Alt+Shift+F3', async () => {
        const { editor, timers } = await setup();
        editor.moveCaret(at(0, 6));
        timers.advance(200);
        await settle();
        expect(editor.press(eventOf(CANVAS_SHORTCUTS.nextHighlight))).toBe(true);
        expect(editor.getCaret()).toEqual(at(1, 0));
        editor.press(eventOf(CANVAS_SHORTCUTS.nextHighlight));
        expect(editor.getCaret()).toEqual(at(2, 6));
        editor.press(eventOf(CANVAS_SHORTCUTS.nextHighlight));
        expect(editor.getCaret()).toEqual(at(0, 4));
        editor.press(eventOf(CANVAS_SHORTCUTS.previousHighlight));
        expect(editor.getCaret()).toEqual(at(2, 6));
    });
});

describe('pure parts', () => {
    test('reads the kinds and orders the marks', () => {
        expect(editorHighlightsOf([{ range: range(1, 0, 1), kind: 2 }, { range: range(0, 0, 0), kind: 1 }, { range: range(0, 2, 4) }])).toEqual([
            { range: range(0, 2, 4), kind: 'text' },
            { range: range(1, 0, 1), kind: 'read' }
        ]);
    });

    test('steps and wraps', () => {
        const ranges = [range(0, 4, 9), range(1, 0, 5)];
        expect(neighborRange(ranges, at(1, 0), 1)).toEqual(ranges[0]);
        expect(neighborRange(ranges, at(0, 4), -1)).toEqual(ranges[1]);
        expect(neighborRange([], at(0, 0), 1)).toBeNull();
    });
});
