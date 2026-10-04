import { describe, expect, test } from 'bun:test';
import { FakeEditorEngine } from '@ruimte/smart-editor/fake';
import { EditorLanguage } from './editor-language';
import { FakeLanguageTransport } from './fake-daemon';
import { covers, withMargin } from './inlay-hints';
import { ProjectLanguage } from './project-language';
import { ManualTimers } from './timers';

const uri = 'file:///work/app/src/a.ts';
const at = (line: number, character: number) => ({ line, character });

async function settle(): Promise<void> {
    for (let turn = 0; turn < 50; turn++) {
        await Promise.resolve();
    }
}

describe('the lines hints are asked for', () => {
    test('are the ones in view with a margin, cut at the ends of the document', () => {
        const end = at(299, 7);
        const endOfLine = (line: number) => at(line, 10);
        expect(withMargin({ start: at(100, 0), end: at(120, 4) }, end, endOfLine)).toEqual({ start: at(40, 0), end: at(180, 10) });
        expect(withMargin({ start: at(2, 0), end: at(30, 4) }, end, endOfLine)).toEqual({ start: at(0, 0), end: at(90, 10) });
        expect(withMargin({ start: at(280, 0), end: at(299, 7) }, end, endOfLine).end).toEqual(end);
    });

    test('hold the view only when every line in it was asked for', () => {
        const asked = { start: at(40, 0), end: at(180, 10) };
        expect(covers(asked, { start: at(60, 0), end: at(90, 0) })).toBe(true);
        expect(covers(asked, { start: at(30, 0), end: at(90, 0) })).toBe(false);
        expect(covers(asked, { start: at(150, 0), end: at(200, 0) })).toBe(false);
    });
});

describe('inlay hints of a long file', () => {
    async function setup() {
        const transport = new FakeLanguageTransport();
        const ranges: { start: { line: number }; end: { line: number } }[] = [];
        transport.answers.set('language.request', (payload: { method: string; params: { range: (typeof ranges)[number] } }) => {
            if (payload.method === 'textDocument/inlayHint') {
                ranges.push(payload.params.range);
            }
            return { result: [], server: 'typescript', version: 1 };
        });
        transport.providers = { 'textDocument/inlayHint': {} };
        const text = Array.from({ length: 400 }, (_, index) => `let v${index} = ${index};`).join('\n');
        const editor = new FakeEditorEngine().mount({} as HTMLElement, { text, theme: 'light' });
        editor.visibleRange = { start: at(100, 0), end: at(120, 12) };
        const timers = new ManualTimers();
        const language = new EditorLanguage(new ProjectLanguage(transport, 'p1', '/work/app'), editor, uri, 'typescript', timers);
        await language.document.ready;
        await settle();
        return { editor, timers, ranges };
    }

    test('are asked for the lines in view only, and again once the view leaves them', async () => {
        const { editor, timers, ranges } = await setup();
        expect(ranges.map((range) => [range.start.line, range.end.line])).toEqual([[40, 180]]);
        editor.scroll({ start: at(130, 0), end: at(150, 12) });
        timers.advance(1000);
        await settle();
        expect(ranges).toHaveLength(1);
        editor.scroll({ start: at(250, 0), end: at(270, 12) });
        timers.advance(1000);
        await settle();
        expect(ranges.map((range) => [range.start.line, range.end.line])).toEqual([
            [40, 180],
            [190, 330]
        ]);
    });
});
