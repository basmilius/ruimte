import { describe, expect, test } from 'bun:test';
import { FakeEditorEngine } from '@ruimte/smart-editor/fake';
import { FakeLanguageTransport } from './fake-daemon';
import { acquireProjectLanguage, ProjectLanguage } from './project-language';

const folder = '/work/app';
const uri = 'file:///work/app/src/a.ts';

async function settle(): Promise<void> {
    for (let turn = 0; turn < 30; turn++) {
        await Promise.resolve();
    }
}

function setup(text = 'let a = 1;\nlet b = 2;') {
    const transport = new FakeLanguageTransport();
    const language = new ProjectLanguage(transport, 'p1', folder);
    const engine = new FakeEditorEngine();
    const editor = engine.mount({} as HTMLElement, { text, theme: 'light' });
    return { transport, language, engine, editor };
}

describe('one editor', () => {
    test('opens its document with its text and sends each edit as a range against the version it leaves', async () => {
        const { transport, language, editor } = setup();
        const handle = language.acquire(uri, 'typescript', editor);
        await handle.ready;
        editor.type('let a = 1;\nlet b = 22;');
        editor.type('let a = 1;\nlet b = 223;');
        await settle();
        expect(transport.callsOf('language.document.open')).toHaveLength(1);
        expect(transport.callsOf('language.document.change').map((call) => (call.payload as { baseVersion: number }).baseVersion)).toEqual([1, 2]);
        expect(transport.documents.get('src/a.ts')).toMatchObject({ text: 'let a = 1;\nlet b = 223;', version: 3 });
        expect(transport.callsOf('language.document.change')[0]!.payload).toMatchObject({
            changes: [{ range: { start: { line: 1, character: 9 }, end: { line: 1, character: 9 } }, text: '2' }]
        });
    });

    test('holds the edits made while the open is in flight and sends them as one change when it is answered', async () => {
        const { transport, language, editor } = setup('a');
        const handle = language.acquire(uri, 'typescript', editor);
        editor.type('ab');
        editor.type('abc');
        await handle.ready;
        await settle();
        expect(transport.callsOf('language.document.change')).toHaveLength(1);
        expect(transport.documents.get('src/a.ts')).toMatchObject({ text: 'abc', version: 2 });
    });

    test('closes the document when the editor lets go', async () => {
        const { transport, language, editor } = setup();
        const handle = language.acquire(uri, 'typescript', editor);
        await handle.ready;
        handle.release();
        await settle();
        expect(transport.callsOf('language.document.close')).toHaveLength(1);
        editor.type('changed');
        await settle();
        expect(transport.callsOf('language.document.change')).toHaveLength(0);
    });
});

describe('two editors on one file', () => {
    test('opens the document once and sends an edit once', async () => {
        const { transport, language, engine, editor } = setup();
        const other = engine.mount({} as HTMLElement, { text: editor.getText(), theme: 'light' });
        const first = language.acquire(uri, 'typescript', editor);
        language.acquire(uri, 'typescript', other);
        await first.ready;
        editor.type('x');
        other.setText('x');
        await settle();
        expect(transport.callsOf('language.document.open')).toHaveLength(1);
        expect(transport.callsOf('language.document.change')).toHaveLength(1);
    });

    test('lets the other editor take over when the first one goes, without closing the document', async () => {
        const { transport, language, engine, editor } = setup();
        const other = engine.mount({} as HTMLElement, { text: 'other text', theme: 'light' });
        const first = language.acquire(uri, 'typescript', editor);
        language.acquire(uri, 'typescript', other);
        await first.ready;
        first.release();
        await settle();
        expect(transport.callsOf('language.document.close')).toHaveLength(0);
        expect(transport.documents.get('src/a.ts')!.text).toBe('other text');
        other.setText('other text!');
        await settle();
        expect(transport.documents.get('src/a.ts')!.text).toBe('other text!');
    });
});

describe('acquireProjectLanguage', () => {
    test('is one per project on a machine and ends with its last release', () => {
        const transport = new FakeLanguageTransport();
        const first = acquireProjectLanguage(transport, 'p1', folder);
        const second = acquireProjectLanguage(transport, 'p1', folder);
        expect(second.language).toBe(first.language);
        first.release();
        second.release();
        expect(acquireProjectLanguage(transport, 'p1', folder).language).not.toBe(first.language);
    });
});
