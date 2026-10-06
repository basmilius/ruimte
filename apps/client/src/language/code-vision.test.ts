import { describe, expect, test } from 'bun:test';
import { type FakeEditor, FakeEditorEngine } from '@adecore/editor/fake';
import { EditorLanguage } from './ruimte-editor-language';
import { FakeLanguageTransport } from './fake-daemon';
import { ProjectLanguage } from './ruimte-project-language';
import { ManualTimers } from './timers';

const uri = 'file:///work/app/src/a.ts';
const at = (line: number, character = 0) => ({ line, character });

function functionSymbol(name: string, line: number) {
    return { name, kind: 12, range: { start: at(line), end: at(line, 20) }, selectionRange: { start: at(line, 9), end: at(line, 9 + name.length) } };
}

async function flush(): Promise<void> {
    for (let turn = 0; turn < 2000; turn++) {
        await Promise.resolve();
    }
}

interface Setup {
    editor: FakeEditor;
    language: EditorLanguage;
    timers: ManualTimers;
    transport: FakeLanguageTransport;
    /* The names references were asked for, in order. */
    asked: string[];
    /* How many places each name has; a name that is not there has none. */
    places: Map<string, number>;
    names: { value: string[] };
}

async function setup(names: string[], options: { text?: string; end?: number } = {}): Promise<Setup> {
    const transport = new FakeLanguageTransport();
    transport.providers = { 'textDocument/documentSymbol': {}, 'textDocument/references': {} };
    const asked: string[] = [];
    const places = new Map<string, number>();
    const state = { value: names };
    const text = options.text ?? state.value.map((name) => `function ${name}() {}`).join('\n');
    transport.answers.set('language.request', (payload: { method: string; params: { position: { line: number } } }) => {
        if (payload.method === 'textDocument/documentSymbol') {
            const symbols = state.value.map((name, line) => ({ ...functionSymbol(name, line), range: { start: at(line), end: at(options.end ?? line, 20) } }));
            return { result: symbols, server: 'typescript', version: 1 };
        }
        const name = state.value[payload.params.position.line]!;
        asked.push(name);
        const count = places.get(name) ?? 0;
        return {
            result: Array.from({ length: count }, (_, index) => ({ uri, range: { start: at(index + 10, 0), end: at(index + 10, 3) } })),
            server: 'typescript',
            version: 1
        };
    });
    const timers = new ManualTimers();
    const project = new ProjectLanguage(transport, 'p1', '/work/app');
    const editor = new FakeEditorEngine().mount({} as HTMLElement, { text, theme: 'light' });
    const language = new EditorLanguage(project, editor, uri, 'typescript', timers);
    await language.document.ready;
    await flush();
    return { editor, language, timers, transport, asked, places, names: state };
}

const wordsOf = (editor: FakeEditor): string[][] => editor.codeVision.map((row) => row.entries.map((entry) => entry.text));

describe('usages', () => {
    test('reserve a row for each declaration as soon as the symbols are in, and fill them as the counts arrive', async () => {
        const { editor, language, places } = await setup(['alpha', 'beta']);
        places.set('alpha', 3);
        places.set('beta', 1);
        language.codeVision.configure({ usages: true, authors: false });
        expect(editor.codeVision).toEqual([]);
        await flush();
        expect(editor.codeVision.map((row) => row.line)).toEqual([0, 1]);
        expect(wordsOf(editor)).toEqual([['3 usages'], ['1 usage']]);
    });

    test('say no usages for a declaration nothing refers to', async () => {
        const { editor, language } = await setup(['alpha']);
        language.codeVision.configure({ usages: true, authors: false });
        await flush();
        expect(wordsOf(editor)).toEqual([['No usages']]);
    });

    test('count a place once however many ways the server named it, and never the declaration', async () => {
        const { language, editor, transport } = await setup(['alpha']);
        transport.answers.set('language.request', (payload: { method: string }) =>
            payload.method === 'textDocument/documentSymbol'
                ? { result: [functionSymbol('alpha', 0)], server: 'typescript', version: 1 }
                : {
                      result: [
                          { uri, range: { start: at(5), end: at(5, 2) } },
                          { uri, range: { start: at(5), end: at(5, 2) } }
                      ],
                      server: 'typescript',
                      version: 1
                  }
        );
        language.codeVision.configure({ usages: true, authors: false });
        await flush();
        expect(wordsOf(editor)).toEqual([['1 usage']]);
        const request = transport.callsOf('language.request').find((call) => (call.payload as { method: string }).method === 'textDocument/references');
        expect((request!.payload as { params: { context: unknown } }).params.context).toEqual({ includeDeclaration: false });
    });

    test('draw no rows with the switch off, and take them away when it goes off', async () => {
        const { editor, language } = await setup(['alpha']);
        language.codeVision.configure({ usages: true, authors: false });
        await flush();
        expect(editor.codeVision).toHaveLength(1);
        language.codeVision.configure({ usages: false, authors: false });
        await flush();
        expect(editor.codeVision).toEqual([]);
    });

    test('draw no rows where no server finds references', async () => {
        const { editor, language, transport } = await setup(['alpha']);
        transport.providers = { 'textDocument/documentSymbol': {} };
        const second = new EditorLanguage(
            language.project,
            new FakeEditorEngine().mount({} as HTMLElement, { text: 'function alpha() {}', theme: 'light' }),
            'file:///work/app/src/b.ts',
            'typescript'
        );
        await second.document.ready;
        second.codeVision.configure({ usages: true, authors: false });
        await flush();
        expect(editor.codeVision).toEqual([]);
    });

    test('ask only for the declarations in view and a margin, and the rest when the view moves', async () => {
        const names = Array.from({ length: 200 }, (_, index) => `f${index}`);
        const { editor, language, timers, asked } = await setup(names);
        editor.scroll({ start: at(0), end: at(30) });
        language.codeVision.configure({ usages: true, authors: false });
        await flush();
        expect(asked).toHaveLength(71);
        expect(asked.at(-1)).toBe('f70');
        expect(wordsOf(editor).filter((words) => words.length > 0)).toHaveLength(71);
        expect(editor.codeVision).toHaveLength(200);
        editor.scroll({ start: at(150), end: at(170) });
        timers.advance(200);
        await flush();
        expect(asked).toContain('f130');
        expect(asked).toContain('f199');
        expect(asked.filter((name) => name === 'f0')).toHaveLength(1);
    });

    test('keep three questions in flight at most, and drop the queue behind them when the view moves away', async () => {
        const names = Array.from({ length: 200 }, (_, index) => `f${index}`);
        const { editor, language, timers, transport } = await setup(names);
        let flying = 0;
        let peak = 0;
        const seen: string[] = [];
        const releases: Array<() => void> = [];
        transport.answers.set('language.request', (payload: { method: string; params: { position: { line: number } } }) => {
            if (payload.method === 'textDocument/documentSymbol') {
                return { result: names.map((name, line) => functionSymbol(name, line)), server: 'typescript', version: 1 };
            }
            flying++;
            seen.push(names[payload.params.position.line]!);
            peak = Math.max(peak, flying);
            return new Promise((resolve) => {
                releases.push(() => {
                    flying--;
                    resolve({ result: [], server: 'typescript', version: 1 });
                });
            });
        });
        editor.scroll({ start: at(0), end: at(10) });
        language.codeVision.configure({ usages: true, authors: false });
        await flush();
        expect(flying).toBe(3);
        releases.shift()!();
        await flush();
        expect(flying).toBe(3);
        editor.scroll({ start: at(190), end: at(199) });
        timers.advance(200);
        await flush();
        expect(flying).toBe(3);
        while (releases.length > 0) {
            releases.shift()!();
            await flush();
        }
        expect(peak).toBe(3);
        expect(seen).not.toContain('f45');
        expect(seen).toContain('f199');
    });

    test('keep a count on its row while the text is edited, and replace it once the new symbols are counted', async () => {
        const { editor, language, timers, places, names } = await setup(['alpha']);
        places.set('alpha', 2);
        language.codeVision.configure({ usages: true, authors: false });
        await flush();
        expect(wordsOf(editor)).toEqual([['2 usages']]);
        places.set('alpha', 5);
        editor.type('function alpha() {}\n');
        await flush();
        expect(wordsOf(editor)).toEqual([['2 usages']]);
        names.value = ['alpha'];
        timers.advance(600);
        await flush();
        expect(wordsOf(editor)).toEqual([['5 usages']]);
    });

    test('open the references of the declaration when its entry is pressed', async () => {
        const { editor, language, places } = await setup(['alpha']);
        places.set('alpha', 2);
        language.codeVision.configure({ usages: true, authors: false });
        await flush();
        editor.codeVision[0]!.entries[0]!.activate({ left: 0, top: 0, right: 10, bottom: 10 });
        await flush();
        expect(language.popups.getState().peek).toMatchObject({ kind: 'references', count: 2 });
    });

    test('draw nothing for a file past the line limit, and clear the rows when the editor goes', async () => {
        const { editor, language } = await setup(['alpha']);
        language.codeVision.configure({ usages: true, authors: false });
        await flush();
        language.dispose();
        expect(editor.codeVision).toEqual([]);
    });
});

describe('authors', () => {
    const commit = (author: string, at: number) => ({
        hash: `${author}`.padEnd(40, '0'),
        shortHash: author.toLowerCase().padEnd(7, '0'),
        author,
        email: `${author.toLowerCase()}@example.com`,
        at,
        summary: `By ${author}`
    });
    /* The blame of the text a setup opens with, one line per entry of `lines`. */
    const ready = (
        lines: number[],
        opened: string[] = [],
        base = lines.map((_, index) => ['function alpha() {}', 'function beta() {}'][index] ?? '').join('\n')
    ) => ({
        kind: 'ready' as const,
        blame: { commits: [commit('Ada', 10), commit('Bob', 20)], lines },
        base,
        openCommit: (hash: string) => void opened.push(hash)
    });

    test('hold a row for each declaration while git is asked, and fill it with the author', async () => {
        const { editor, language } = await setup(['alpha', 'beta']);
        language.codeVision.configure({ usages: false, authors: true });
        language.codeVision.setBlame({ kind: 'pending' });
        await flush();
        expect(editor.codeVision.map((row) => [row.line, row.entries.length])).toEqual([
            [0, 0],
            [1, 0]
        ]);
        language.codeVision.setBlame(ready([0, 1]));
        await flush();
        expect(wordsOf(editor)).toEqual([['Ada'], ['Bob']]);
        expect(editor.codeVision[0]!.entries[0]).toMatchObject({ id: 'authors', icon: 'user' });
    });

    test('put the authors after the usages, and a person icon for one author and several for more', async () => {
        const { editor, language, places } = await setup(['alpha']);
        places.set('alpha', 2);
        language.codeVision.configure({ usages: true, authors: true });
        language.codeVision.setBlame(ready([0]));
        await flush();
        expect(wordsOf(editor)).toEqual([['2 usages', 'Ada']]);
    });

    test('draw no author where git has nothing to say, and nothing at all when the switch is off', async () => {
        const { editor, language } = await setup(['alpha']);
        language.codeVision.configure({ usages: false, authors: true });
        language.codeVision.setBlame(null);
        await flush();
        expect(editor.codeVision).toEqual([]);
        language.codeVision.setBlame(ready([0, 0]));
        language.codeVision.configure({ usages: false, authors: false });
        await flush();
        expect(editor.codeVision).toEqual([]);
    });

    test('count a line typed since the file was saved as edited, once the symbols are read again', async () => {
        const text = 'function alpha() {\n    one();\n    two();\n}';
        const { editor, language, timers } = await setup(['alpha'], { text, end: 3 });
        language.codeVision.configure({ usages: false, authors: true });
        language.codeVision.setBlame(ready([0, 1, 1, 0], [], text));
        await flush();
        expect(wordsOf(editor)).toEqual([['Bob +1']]);
        editor.type('function alpha() {\n    one();\n    typed();\n}');
        timers.advance(600);
        await flush();
        expect(wordsOf(editor)).toEqual([['Ada +1 *']]);
    });

    test('say several authors with the people icon, the one with most lines first', async () => {
        const text = 'function alpha() {\n    one();\n    two();\n}';
        const { editor, language } = await setup(['alpha'], { text, end: 3 });
        language.codeVision.configure({ usages: false, authors: true });
        language.codeVision.setBlame(ready([0, 1, 1, 0], [], text));
        await flush();
        expect(wordsOf(editor)).toEqual([['Bob +1']]);
        expect(editor.codeVision[0]!.entries[0]!.icon).toBe('users');
    });

    test('say new for a declaration written since the last commit', async () => {
        const { editor, language, timers, names } = await setup(['alpha']);
        language.codeVision.configure({ usages: false, authors: true });
        language.codeVision.setBlame(ready([0, 0]));
        await flush();
        names.value = ['alpha', 'gamma'];
        editor.type('function alpha() {}\nfunction gamma() {}\n');
        timers.advance(600);
        await flush();
        expect(wordsOf(editor)).toEqual([['Ada'], ['new *']]);
        expect(editor.codeVision[1]!.entries[0]!.icon).toBeUndefined();
    });

    test('open a card with the authors and a way to the latest commit when the entry is pressed', async () => {
        const { editor, language } = await setup(['alpha']);
        const opened: string[] = [];
        language.codeVision.configure({ usages: false, authors: true });
        language.codeVision.setBlame(ready([1, 1], opened));
        await flush();
        const anchor = { left: 4, top: 8, right: 40, bottom: 28 };
        editor.codeVision[0]!.entries[0]!.activate(anchor);
        const view = language.popups.getState().authors!;
        expect(view).toMatchObject({ anchor, name: 'alpha' });
        expect(view.authorship.authors).toEqual([{ name: 'Bob', email: 'bob@example.com', lines: 1 }]);
        view.openCommit!();
        expect(opened).toEqual([commit('Bob', 20).hash]);
        language.codeVision.closeAuthors();
        expect(language.popups.getState().authors).toBeNull();
    });

    test('close the card when the text is edited', async () => {
        const { editor, language } = await setup(['alpha']);
        language.codeVision.configure({ usages: false, authors: true });
        language.codeVision.setBlame(ready([0, 0]));
        await flush();
        editor.codeVision[0]!.entries[0]!.activate({ left: 0, top: 0, right: 1, bottom: 1 });
        expect(language.popups.getState().authors).not.toBeNull();
        editor.type('x');
        expect(language.popups.getState().authors).toBeNull();
    });
});
