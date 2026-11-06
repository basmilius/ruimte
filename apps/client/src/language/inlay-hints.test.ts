import { describe, expect, test } from 'bun:test';
import { ManualTimers } from '@adecore/editor-react/testing';
import { FakeEditorEngine } from '@adecore/editor/fake';
import { FakeLanguageTransport } from './fake-daemon';
import { createEditorLanguage } from './ruimte-editor-language';
import { RuimteProject } from './ruimte-project';
import { settleLanguage as settle } from './settle.test';

const uri = 'file:///work/app/src/a.ts';
const at = (line: number, character: number) => ({ line, character });

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
        const language = createEditorLanguage(new RuimteProject(transport, 'p1', '/work/app'), editor, uri, 'typescript', timers);
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
