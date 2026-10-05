import { describe, expect, test } from 'bun:test';
import { mountEditor } from './testing.ts';
import type { EditorFindQuery, EditorFindState, EditorOptions, KeyChord, LineTokenizer, SmartEditorEngineOptions } from './types.ts';

function setup(options: Partial<EditorOptions> = {}, engineOptions: Partial<SmartEditorEngineOptions> = {}) {
    const mounted = mountEditor(options, engineOptions);
    return { ...mounted.page, ...mounted, host: mounted.page.host };
}

const settle = async (): Promise<void> => {
    for (let i = 0; i < 4; i++) {
        await Promise.resolve();
    }
};

describe('mounting', () => {
    test('draws the lines and their numbers', () => {
        const { host } = setup();
        expect(host.querySelectorAll('.se-line').length).toBe(3);
        expect(host.querySelector('.se-line')!.textContent).toBe('one');
        expect([...host.querySelectorAll('.se-line-number')].map((item) => item.textContent)).toEqual(['1', '2', '3']);
    });

    test('opens on a line and column, one-based', () => {
        const { editor, host } = setup({ line: 2, column: 3 });
        expect(host.querySelector('.se-active-number')!.textContent).toBe('2');
        editor.dispose();
    });

    test('draws only the rows near the viewport of a long file', () => {
        const text = Array.from({ length: 5000 }, (_, i) => `line ${i}`).join('\n');
        const { host } = setup({ text });
        expect(host.querySelectorAll('.se-line').length).toBeLessThan(60);
    });

    test('reads a line past the end as the last one', () => {
        const { editor, host } = setup({ line: 99, column: 99 });
        expect(host.querySelector('.se-active-number')!.textContent).toBe('3');
        editor.dispose();
    });
});

describe('folding by default', () => {
    const text = 'class A {\n    run() {\n        body();\n    }\n}\n';

    test('folds a symbol body once the host hands over the symbols, as positions', () => {
        const { editor } = setup({ text, language: 'typescript', foldDefaults: ['method-body'] });
        expect(editor.getFolds().collapsed).toEqual([]);
        editor.setFoldHints({ symbols: [{ range: { start: { line: 1, character: 4 }, end: { line: 3, character: 5 } }, body: 'method' }] });
        expect(editor.getFolds().collapsed).toEqual([{ startLine: 1, endLine: 3 }]);
    });

    test('keeps a fold open that hides the line the file opens on', () => {
        const nested = '/**\n * Doc.\n */\nclass A {\n}\n';
        const { editor } = setup({ text: nested, language: 'typescript', foldDefaults: ['doc-comment'], line: 2, column: 1 });
        expect(editor.getFolds().collapsed).toEqual([]);
        expect(editor.getCaret()).toEqual({ line: 1, character: 0 });
    });

    test('folds what the text gives at mount, and runs the commands that fold by level', () => {
        const nested = '/**\n * Doc.\n */\nclass A {\n    run() {\n        body();\n    }\n}\n';
        const { editor } = setup({ text: nested, language: 'typescript', foldDefaults: ['doc-comment'] });
        expect(editor.getFolds().collapsed).toEqual([{ startLine: 0, endLine: 2 }]);
        editor.runCommand('expandDocComments');
        expect(editor.getFolds().collapsed).toEqual([]);
        editor.runCommand('expandAllToLevel1');
        expect(editor.getFolds().collapsed).toEqual([{ startLine: 4, endLine: 6 }]);
        editor.runCommand('collapseDocComments');
        expect(editor.getFolds().collapsed).toEqual([
            { startLine: 0, endLine: 2 },
            { startLine: 4, endLine: 6 }
        ]);
    });
});

describe('indentation', () => {
    test('takes the tab size and style it is given, at mount and later', () => {
        const { editor, press } = setup({ text: 'a', indentation: { tabSize: 2, insertSpaces: true } });
        press('Tab');
        expect(editor.getText()).toBe('  a');
        editor.setIndentation({ tabSize: 4, insertSpaces: false });
        press('Tab');
        expect(editor.getText()).toBe('  \ta');
    });
});

describe('typing', () => {
    test('puts typed text in the document and tells the listeners once per edit', () => {
        const { editor, type } = setup();
        let changes = 0;
        editor.onChange(() => changes++);
        type('x');
        type('y');
        expect(editor.getText()).toBe('xyone\ntwo\nthree');
        expect(changes).toBe(2);
    });

    test('pairs a bracket and types over the closer', () => {
        const { editor, type } = setup({ text: '', language: 'typescript' });
        type('(');
        expect(editor.getText()).toBe('()');
        type(')');
        expect(editor.getText()).toBe('()');
    });

    test('undoes and redoes with the keyboard', () => {
        const { editor, type, press: key } = setup({ text: '' });
        type('a');
        expect(key('z', { ctrlKey: true })).toBe(true);
        expect(editor.getText()).toBe('');
        key('z', { ctrlKey: true, shiftKey: true });
        expect(editor.getText()).toBe('a');
    });

    test('breaks the line on Enter', () => {
        const { editor, press: key } = setup({ text: 'a' });
        key('Enter');
        expect(editor.getText()).toBe('\na');
    });
});

describe('a collapsed fold as one unit', () => {
    const text = 'one\nfunction a() {\n    body();\n}\ntwo\nthree';
    const folded = (extra: Partial<EditorOptions> = {}) =>
        setup({ text, language: 'typescript', folds: { collapsed: [{ startLine: 1, endLine: 3 }], custom: [] }, line: 2, column: 1, ...extra });

    test('deletes, duplicates and comments the whole fold', () => {
        const deleted = folded();
        deleted.editor.runCommand('deleteLine');
        expect(deleted.editor.getText()).toBe('one\ntwo\nthree');
        const copied = folded();
        copied.editor.runCommand('duplicateLine');
        expect(copied.editor.getText()).toBe('one\nfunction a() {\n    body();\n}\nfunction a() {\n    body();\n}\ntwo\nthree');
        const commented = folded();
        commented.editor.runCommand('toggleLineComment');
        expect(commented.editor.getText()).toBe('one\n// function a() {\n//     body();\n// }\ntwo\nthree');
        expect(commented.editor.getFolds().collapsed).toEqual([{ startLine: 1, endLine: 3 }]);
    });

    test('moves the whole fold and keeps it collapsed on the lines it went to', () => {
        const { editor } = folded();
        editor.runCommand('moveLineUp');
        expect(editor.getText()).toBe('function a() {\n    body();\n}\none\ntwo\nthree');
        expect(editor.getFolds().collapsed).toEqual([{ startLine: 0, endLine: 2 }]);
        editor.runCommand('moveLineDown');
        editor.runCommand('moveLineDown');
        expect(editor.getText()).toBe('one\ntwo\nfunction a() {\n    body();\n}\nthree');
        expect(editor.getFolds().collapsed).toEqual([{ startLine: 2, endLine: 4 }]);
    });

    test('copies and cuts the whole fold when nothing is selected', () => {
        const copied = folded();
        expect(copied.clip('copy')).toBe('function a() {\n    body();\n}\n');
        const cut = folded();
        expect(cut.clip('cut')).toBe('function a() {\n    body();\n}\n');
        expect(cut.editor.getText()).toBe('one\ntwo\nthree');
    });

    test('steps over it as one word stop and adds carets past it', () => {
        const { editor } = folded();
        editor.setCaret({ line: 1, character: 14 });
        editor.runCommand('wordRight');
        expect(editor.getCaret()).toEqual({ line: 4, character: 0 });
        expect(editor.getFolds().collapsed).toEqual([{ startLine: 1, endLine: 3 }]);
        editor.runCommand('wordLeft');
        expect(editor.getCaret()).toEqual({ line: 1, character: 14 });
        editor.setCaret({ line: 0, character: 1 });
        editor.runCommand('addCaretBelow');
        editor.runCommand('addCaretBelow');
        expect(editor.getSelections().map((range) => range.start.line)).toEqual([0, 1, 4]);
        expect(editor.getFolds().collapsed).toEqual([{ startLine: 1, endLine: 3 }]);
    });
});

describe('copying a line without a selection', () => {
    test('pastes as whole lines in another editor too', () => {
        const source = setup({ text: 'one\ntwo', line: 2, column: 2 });
        const copied = source.clip('copy');
        expect(copied).toBe('two\n');
        const target = setup({ text: 'a\nb', line: 2, column: 2 });
        target.clip('paste', copied);
        expect(target.editor.getText()).toBe('a\ntwo\nb');
    });
});

describe('setSelections', () => {
    test('puts a caret in each range and makes the last the primary one', () => {
        const { editor } = setup({ text: 'one\ntwo\nthree' });
        editor.setSelections([
            { start: { line: 0, character: 1 }, end: { line: 0, character: 1 } },
            { start: { line: 1, character: 0 }, end: { line: 1, character: 2 } },
            { start: { line: 2, character: 3 }, end: { line: 2, character: 3 } }
        ]);
        expect(editor.getSelections()).toHaveLength(3);
        expect(editor.getSelection()).toEqual({ start: { line: 2, character: 3 }, end: { line: 2, character: 3 } });
        expect(editor.getSelections()[1]).toEqual({ start: { line: 1, character: 0 }, end: { line: 1, character: 2 } });
        editor.setSelections([]);
        expect(editor.getSelections()).toHaveLength(3);
    });
});

describe('setText', () => {
    test('is not reported as a change', () => {
        const { editor } = setup();
        let changes = 0;
        editor.onChange(() => changes++);
        editor.setText('one\nTWO\nthree');
        expect(editor.getText()).toBe('one\nTWO\nthree');
        expect(changes).toBe(0);
    });

    test('keeps the cursor where the text around it stayed', () => {
        const { editor, host, type } = setup({ text: 'one\ntwo\nthree', line: 3, column: 3 });
        editor.setText('0\n1\none\ntwo\nthree');
        type('!');
        expect(editor.getText()).toBe('0\n1\none\ntwo\nth!ree');
        expect(host.querySelector('.se-active-number')!.textContent).toBe('5');
    });

    test('keeps carets, scroll and folds wherever the text around them stayed, between two far apart changes', () => {
        const blocks = Array.from({ length: 30 }, (_, block) => [
            `function f${block}() {`,
            ...Array.from({ length: 8 }, (_, row) => `    body(${block}, ${row});`),
            '}'
        ]);
        const lines = blocks.flat();
        const text = lines.join('\n');
        const { editor, viewport, window } = setup({
            text,
            language: 'typescript',
            folds: {
                collapsed: [
                    { startLine: 100, endLine: 109 },
                    { startLine: 200, endLine: 209 }
                ],
                custom: []
            },
            line: 151,
            column: 5
        });
        editor.setSelection({ start: { line: 150, character: 4 }, end: { line: 150, character: 4 } });
        editor.runCommand('addCaretBelow');
        editor.runCommand('addCaretBelow');
        viewport.scrollTop = 124 * 20;
        viewport.dispatchEvent(new (window as unknown as { Event: typeof Event }).Event('scroll'));
        const caretLines = (): number[] => editor.getSelections().map((range) => range.start.line);
        const before = { carets: caretLines(), top: editor.getVisibleRange().start.line };
        expect(before.carets).toEqual([150, 151, 152]);
        const changed = [...lines];
        changed[5] = '    changed();\n    inserted();';
        changed[290] = '    rewritten();';
        editor.setText(changed.join('\n'));
        expect(caretLines()).toEqual([151, 152, 153]);
        expect(editor.getFolds().collapsed).toEqual([
            { startLine: 101, endLine: 110 },
            { startLine: 201, endLine: 210 }
        ]);
        expect(editor.getVisibleRange().start.line).toBe(before.top + 1);
    });

    test('is one undo step and an external change, however many stretches it replaces', () => {
        const { editor, press: key } = setup({ text: 'a\nb\nc\nd\ne' });
        const sources: string[] = [];
        editor.onTextChange((change) => sources.push(change.source));
        editor.setText('A\nb\nc\nd\nE');
        expect(sources).toEqual(['external']);
        key('z', { ctrlKey: true });
        expect(editor.getText()).toBe('a\nb\nc\nd\ne');
    });

    test('does nothing for the text it already has', () => {
        const { editor, host } = setup();
        const before = host.innerHTML;
        editor.setText('one\ntwo\nthree');
        expect(host.innerHTML).toBe(before);
    });

    test('is still undoable by what a person typed afterwards', () => {
        const { editor, type, press: key } = setup({ text: 'a' });
        editor.setText('ab');
        type('c');
        key('z', { ctrlKey: true });
        expect(editor.getText()).toBe('ab');
    });
});

describe('saving, blur and shortcuts', () => {
    test('reports Mod+S as a save and not as a change', () => {
        const { editor, press: key } = setup();
        let saves = 0;
        let changes = 0;
        editor.onSave(() => saves++);
        editor.onChange(() => changes++);
        expect(key('s', { ctrlKey: true })).toBe(true);
        expect(saves).toBe(1);
        expect(changes).toBe(0);
    });

    test('takes the Cmd key for Mod on macOS', () => {
        const { editor, press: key } = setup({}, { apple: true });
        let saves = 0;
        editor.onSave(() => saves++);
        key('s', { ctrlKey: true });
        key('s', { metaKey: true });
        expect(saves).toBe(1);
    });

    test('lets a shortcut of the app through even where the editor binds the same key', () => {
        const palette: KeyChord = { mod: true, ctrl: false, meta: false, alt: false, shift: false, key: 'D' };
        const handed = setup({ text: 'a' }, { handBack: [palette] });
        expect(handed.press('d', { ctrlKey: true })).toBe(false);
        expect(handed.editor.getText()).toBe('a');
        const own = setup({ text: 'a' });
        expect(own.press('d', { ctrlKey: true })).toBe(true);
        expect(own.editor.getText()).toBe('a\na');
    });

    test('stops reporting once a listener unsubscribes', () => {
        const { editor, press: key } = setup();
        let saves = 0;
        const off = editor.onSave(() => saves++);
        key('s', { ctrlKey: true });
        off();
        key('s', { ctrlKey: true });
        expect(saves).toBe(1);
    });
});

describe('read only', () => {
    test('refuses typing and says why', () => {
        const { editor, host, type, press: key } = setup({ readOnly: true, readOnlyReason: 'Too large to edit' });
        type('x');
        key('Backspace');
        expect(editor.getText()).toBe('one\ntwo\nthree');
        const notice = host.querySelector('.se-notice')!;
        expect(notice.textContent).toBe('Too large to edit');
        expect(notice.hasAttribute('hidden')).toBe(false);
    });

    test('still lets the cursor move and Mod+S through', () => {
        const { editor, press: key } = setup({ readOnly: true });
        let saves = 0;
        editor.onSave(() => saves++);
        expect(key('ArrowRight')).toBe(true);
        key('s', { ctrlKey: true });
        expect(saves).toBe(1);
    });

    test('takes typing again once it is not read only', () => {
        const { editor, type } = setup({ text: '', readOnly: true });
        editor.setReadOnly(false);
        type('a');
        expect(editor.getText()).toBe('a');
        editor.setReadOnly(true, 'Locked');
        type('b');
        expect(editor.getText()).toBe('a');
    });
});

describe('find', () => {
    const query = (text: string, extra = {}) => ({ text, caseSensitive: false, wholeWord: false, regex: false, ...extra });

    test('counts and marks every match and starts at the cursor', () => {
        const { editor, host } = setup({ text: 'ab ab\nAB ab', line: 1, column: 2 });
        const states: EditorFindState[] = [];
        editor.onFind((state) => states.push(state));
        editor.find(query('ab'));
        expect(states.at(-1)).toEqual({ count: 4, current: 1 });
        expect(host.querySelectorAll('.se-find-match').length + host.querySelectorAll('.se-find-current').length).toBe(4);
        expect(host.querySelectorAll('.se-find-current').length).toBe(1);
    });

    test('steps through the matches and around the ends', () => {
        const { editor } = setup({ text: 'a a a' });
        let state: EditorFindState = { count: 0, current: null };
        editor.onFind((next) => (state = next));
        editor.find(query('a'));
        expect(state).toEqual({ count: 3, current: 0 });
        editor.findStep(-1);
        expect(state.current).toBe(2);
        editor.findStep(1);
        expect(state.current).toBe(0);
    });

    test('follows the options of the query', () => {
        const { editor } = setup({ text: 'Cat cat concat' });
        let state: EditorFindState = { count: 0, current: null };
        editor.onFind((next) => (state = next));
        editor.find(query('cat', { caseSensitive: true }));
        expect(state.count).toBe(2);
        editor.find(query('cat', { wholeWord: true }));
        expect(state.count).toBe(2);
        editor.find(query('c.t', { regex: true }));
        expect(state.count).toBe(3);
    });

    test('finds nothing for a pattern that does not parse', () => {
        const { editor } = setup({ text: 'a(b' });
        let state: EditorFindState = { count: 9, current: 0 };
        editor.onFind((next) => (state = next));
        editor.find(query('(', { regex: true }));
        expect(state).toEqual({ count: 0, current: null });
    });

    test('counts again when an edit changes the matches', () => {
        const { editor, type } = setup({ text: 'a' });
        let state: EditorFindState = { count: 0, current: null };
        editor.onFind((next) => (state = next));
        editor.find(query('a'));
        type('a');
        expect(state.count).toBe(2);
    });

    test('takes the marks away and selects the match it was on when it ends', () => {
        const { editor, host, type } = setup({ text: 'xx foo xx foo' });
        editor.find(query('foo'));
        editor.findStep(1);
        editor.endFind();
        expect(host.querySelectorAll('.se-find-match, .se-find-current').length).toBe(0);
        type('Z');
        expect(editor.getText()).toBe('xx foo xx Z');
    });

    test('ends cleanly with no find in progress', () => {
        const { editor } = setup();
        editor.find(null);
        editor.endFind();
        expect(editor.getText()).toBe('one\ntwo\nthree');
    });
});

describe('revealing a line', () => {
    test('puts the cursor at the start of the line', () => {
        const { editor, type } = setup();
        editor.revealLine(3);
        type('>');
        expect(editor.getText()).toBe('one\ntwo\n>three');
    });

    test('clamps a line outside the document', () => {
        const { editor, type } = setup();
        editor.revealLine(-4);
        type('>');
        editor.revealLine(40);
        type('<');
        expect(editor.getText()).toBe('>one\ntwo\n<three');
    });
});

describe('coloring', () => {
    function tokenizer(): LineTokenizer {
        return {
            tokenizeLine: (text) => ({ tokens: [{ length: text.length, color: '#112233', fontStyle: 0 }], state: null }),
            sameState: () => true
        };
    }

    test('draws what the language servers classified in the colors of the theme, over the grammar, and keeps it on its text through an edit', async () => {
        const { host, editor, type } = setup(
            { language: 'typescript', text: 'let name = call();' },
            {
                tokenizer: async () => tokenizer(),
                scopeColors: async () => (scopes) => (scopes.includes('entity.name.function') ? { color: '#ff0000', fontStyle: 0 } : undefined)
            }
        );
        await settle();
        editor.setSemanticTokens([
            { line: 0, character: 11, length: 4, scopes: ['meta.function-call', 'entity.name.function'] },
            { line: 0, character: 4, length: 4, scopes: ['variable'] }
        ]);
        const colored = (): string[] =>
            [...host.querySelectorAll('.se-run span')]
                .filter((span) => span.getAttribute('style')?.includes('255, 0, 0') || span.getAttribute('style')?.includes('#ff0000'))
                .map((span) => span.textContent!);
        expect(colored()).toEqual(['call']);
        editor.setCaret({ line: 0, character: 0 });
        type('xx');
        expect(colored()).toEqual(['call']);
        editor.setSemanticTokens(null);
        expect(colored()).toEqual([]);
    });

    test('colors the lines once the tokenizer arrives', async () => {
        const { host } = setup({ language: 'typescript' }, { tokenizer: async () => tokenizer() });
        expect(host.querySelector('.se-run span')).toBeNull();
        await settle();
        expect(host.querySelector('.se-run span')!.getAttribute('style')).toContain('color');
    });

    test('asks for a tokenizer for the language and theme, and again for a new theme', async () => {
        const asked: (string | undefined)[] = [];
        const { editor } = setup(
            { language: 'php', theme: 'light' },
            {
                tokenizer: async (language, theme) => {
                    asked.push(`${language}:${theme}`);
                    return null;
                }
            }
        );
        editor.setTheme('dark');
        editor.setTheme('dark');
        await settle();
        expect(asked).toEqual(['php:light', 'php:dark']);
    });

    test('keeps the latest theme when an earlier one answers last', async () => {
        let resolveFirst: (value: LineTokenizer | null) => void = () => {};
        let calls = 0;
        const { host, editor } = setup(
            { language: 'php', theme: 'light' },
            {
                tokenizer: (_language, _theme) => {
                    calls++;
                    return calls === 1 ? new Promise((resolve) => (resolveFirst = resolve)) : Promise.resolve(null);
                }
            }
        );
        editor.setTheme('dark');
        await settle();
        resolveFirst(tokenizer());
        await settle();
        expect(host.querySelector('.se-run span')).toBeNull();
    });
});

describe('disposing', () => {
    test('takes its DOM away and stops answering', () => {
        const { editor, host, press: key } = setup();
        let saves = 0;
        editor.onSave(() => saves++);
        editor.dispose();
        expect(host.querySelector('.se-editor')).toBeNull();
        key('s', { ctrlKey: true });
        expect(saves).toBe(0);
        editor.dispose();
    });
});

describe('replace', () => {
    const query = (text: string, options: Partial<EditorFindQuery> = {}): EditorFindQuery => ({
        text,
        caseSensitive: false,
        wholeWord: false,
        regex: false,
        ...options
    });

    test('replaces the current match and moves on to the next', () => {
        const { editor } = setup({ text: 'a one a two a three' });
        const states: EditorFindState[] = [];
        editor.onFind((state) => states.push(state));
        editor.find(query('a'));
        expect(editor.replace('X')).toBe(true);
        expect(editor.getText()).toBe('X one a two a three');
        expect(states.at(-1)).toEqual({ count: 2, current: 0 });
        editor.replace('Y');
        expect(editor.getText()).toBe('X one Y two a three');
    });

    test('looks for the next match after what it wrote when the replacement holds the query', () => {
        const { editor } = setup({ text: 'a a' });
        editor.find(query('a'));
        editor.replace('aa');
        expect(editor.getText()).toBe('aa a');
        editor.replace('aa');
        expect(editor.getText()).toBe('aa aa');
    });

    test('expands the groups of a regular expression and replaces every match as one undo step', () => {
        const { editor, press } = setup({ text: 'ab1 cd2' });
        editor.find(query('([a-z]+)(\\d)', { regex: true }));
        expect(editor.replaceAll('$2$1')).toBe(2);
        expect(editor.getText()).toBe('1ab 2cd');
        press('z', { ctrlKey: true });
        expect(editor.getText()).toBe('ab1 cd2');
    });

    test('does nothing without a match, with a pattern that does not parse or in a read-only editor', () => {
        const { editor } = setup({ text: 'abc', readOnly: true, readOnlyReason: 'Read only' });
        editor.find(query('b'));
        expect(editor.replace('x')).toBe(false);
        expect(editor.replaceAll('x')).toBe(0);
        expect(editor.getText()).toBe('abc');
        const writable = setup({ text: 'abc' }).editor;
        writable.find(query('('));
        expect(writable.replace('x')).toBe(false);
        expect(writable.replaceAll('x')).toBe(0);
        writable.find(query('zzz'));
        expect(writable.replace('x')).toBe(false);
    });

    test('reports the edit as a change', () => {
        const { editor } = setup({ text: 'a a' });
        let changes = 0;
        editor.onChange(() => changes++);
        editor.find(query('a'));
        editor.replaceAll('b');
        expect(changes).toBe(1);
    });
});

describe('find in the selection and the rest of the find', () => {
    const query = (text: string, options: Partial<EditorFindQuery> = {}): EditorFindQuery => ({
        text,
        caseSensitive: false,
        wholeWord: false,
        regex: false,
        ...options
    });

    test('searches only the text that was selected when it turned on, and follows it through edits', () => {
        const { editor } = setup({ text: 'a\na\na\na' });
        const states: EditorFindState[] = [];
        editor.onFind((state) => states.push(state));
        editor.setSelection({ start: { line: 1, character: 0 }, end: { line: 2, character: 1 } });
        editor.find(query('a', { inSelection: true }));
        expect(states.at(-1)).toMatchObject({ count: 2 });
        editor.setCaret({ line: 0, character: 0 });
        editor.find(query('a', { inSelection: true, caseSensitive: true }));
        expect(states.at(-1)).toMatchObject({ count: 2 });
        editor.applyEdits([{ range: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } }, text: 'a\n' }]);
        editor.find(query('a', { inSelection: true, caseSensitive: true, wholeWord: true }));
        expect(states.at(-1)).toMatchObject({ count: 2 });
    });

    test('says when nothing was selected', () => {
        const { editor } = setup({ text: 'a a' });
        const states: EditorFindState[] = [];
        editor.onFind((state) => states.push(state));
        editor.find(query('a', { inSelection: true }));
        expect(states.at(-1)).toEqual({ count: 0, current: null, noSelection: true });
    });

    test('replaces all only inside the selection', () => {
        const { editor } = setup({ text: 'a\na\na' });
        editor.setSelection({ start: { line: 0, character: 0 }, end: { line: 1, character: 1 } });
        editor.find(query('a', { inSelection: true }));
        expect(editor.replaceAll('b')).toBe(2);
        expect(editor.getText()).toBe('b\nb\na');
    });

    test('gives a replacement the case of the match when asked', () => {
        const { editor } = setup({ text: 'foo Foo FOO' });
        editor.find(query('foo'));
        expect(editor.replaceAll('bar', { preserveCase: true })).toBe(3);
        expect(editor.getText()).toBe('bar Bar BAR');
    });

    test('puts a caret on every match, the current one last, and ends the find', () => {
        const { editor, type } = setup({ text: 'a b a b a' });
        editor.setCaret({ line: 0, character: 3 });
        editor.find(query('a'));
        expect(editor.selectFindMatches()).toBe(3);
        expect(editor.getCaret()).toEqual({ line: 0, character: 5 });
        type('x');
        expect(editor.getText()).toBe('x b x b x');
    });

    test('draws what a regular expression writes under the current match, and only when it differs from the replacement', () => {
        const { editor, host } = setup({ text: 'ab1 cd2' });
        editor.find(query('([a-z]+)(\\d)', { regex: true }));
        editor.setReplacePreview('$2$1');
        expect(host.querySelector('.se-preview')!.textContent).toBe('1ab');
        expect(host.querySelector('.se-preview')!.hasAttribute('hidden')).toBe(false);
        editor.setReplacePreview('x');
        expect(host.querySelector('.se-preview')!.hasAttribute('hidden')).toBe(true);
        editor.setReplacePreview('$2$1');
        editor.find(query('ab', { regex: false }));
        expect(host.querySelector('.se-preview')!.hasAttribute('hidden')).toBe(true);
        editor.setReplacePreview(null);
        expect(host.querySelector('.se-preview')!.hasAttribute('hidden')).toBe(true);
    });

    test('finds the next and the previous match from the cursor without a find, going round at the ends', () => {
        const { editor } = setup({ text: 'foo bar foo bar foo' });
        editor.setCaret({ line: 0, character: 5 });
        expect(editor.findFromCursor(query('foo'), 1)).toBe(true);
        expect(editor.getSelection()).toEqual({ start: { line: 0, character: 8 }, end: { line: 0, character: 11 } });
        editor.findFromCursor(query('foo'), 1);
        expect(editor.getSelection().start.character).toBe(16);
        editor.findFromCursor(query('foo'), 1);
        expect(editor.getSelection().start.character).toBe(0);
        editor.findFromCursor(query('foo'), -1);
        expect(editor.getSelection().start.character).toBe(16);
        editor.findFromCursor(query('foo'), -1);
        expect(editor.getSelection().start.character).toBe(8);
        expect(editor.findFromCursor(query('zzz'), 1)).toBe(false);
    });
});

describe('text changes', () => {
    test('reports every change as a language server wants it, an outside setText and an undo included', () => {
        const { editor, type, press } = setup({ text: 'one\ntwo' });
        const heard: unknown[] = [];
        editor.onTextChange((change) => heard.push(change.changes));
        editor.setText('one\ntwo!');
        expect(heard.at(-1)).toEqual([{ range: { start: { line: 1, character: 3 }, end: { line: 1, character: 3 } }, text: '!' }]);
        type('x');
        expect(heard).toHaveLength(2);
        press('z', { metaKey: true });
        press('z', { ctrlKey: true });
        expect(heard.length).toBeGreaterThan(2);
    });

    test('turns offsets into positions and back', () => {
        const { editor } = setup({ text: 'one\ntwo' });
        expect(editor.positionAt(5)).toEqual({ line: 1, character: 1 });
        expect(editor.offsetAt({ line: 1, character: 2 })).toBe(6);
        expect(editor.offsetAt({ line: 9, character: 9 })).toBe(7);
    });
});

describe('markers', () => {
    const range = (line: number, start: number, end: number) => ({ start: { line, character: start }, end: { line, character: end } });

    test('draws a squiggle for an error, a tick in the scroll track, and none for a hint', () => {
        const { editor, host } = setup({ text: 'let a = 1;\nlet b = 2;' });
        editor.setMarkers([
            { range: range(0, 4, 5), severity: 'error' },
            { range: range(1, 4, 5), severity: 'hint', unnecessary: true }
        ]);
        expect(host.querySelectorAll('.se-squiggle-error')).toHaveLength(1);
        expect(host.querySelectorAll('.se-squiggle')).toHaveLength(1);
        expect(host.querySelectorAll('.se-faded')).toHaveLength(1);
        expect(host.querySelectorAll('.se-tick-error')).toHaveLength(1);
        expect(host.querySelectorAll('.se-tick-warning')).toHaveLength(0);
    });

    test('strikes through what is deprecated', () => {
        const { editor, host } = setup({ text: 'old()' });
        editor.setMarkers([{ range: range(0, 0, 3), severity: 'hint', deprecated: true }]);
        expect(host.querySelectorAll('.se-struck')).toHaveLength(1);
    });

    test('keeps a marker on its text through an edit before it, and takes them away when asked', () => {
        const { editor, host, type } = setup({ text: 'let a = 1;' });
        editor.setMarkers([{ range: range(0, 4, 5), severity: 'warning' }]);
        editor.setCaret({ line: 0, character: 0 });
        type('xx');
        const squiggle = host.querySelector('.se-squiggle-warning') as HTMLElement;
        const before = Number.parseFloat(squiggle.style.left);
        expect(before).toBeGreaterThan(0);
        editor.setMarkers([]);
        expect(host.querySelectorAll('.se-squiggle')).toHaveLength(0);
    });
});

describe('keys and positions', () => {
    test('lets a handler take a key before the editor does', () => {
        const { editor, press } = setup({ text: 'abc' });
        let seen = '';
        const off = editor.onKeyDown((event) => {
            seen += event.key;
            return event.key === 'Enter';
        });
        expect(press('Enter')).toBe(true);
        expect(editor.getText()).toBe('abc');
        press('Home');
        expect(seen).toBe('EnterHome');
        off();
        press('Enter');
        expect(editor.getText()).not.toBe('abc');
    });

    test('says where the caret is and moves it', () => {
        const { editor } = setup({ text: 'one\ntwo' });
        const heard: unknown[] = [];
        editor.onCaret((position) => heard.push(position));
        editor.setCaret({ line: 1, character: 2 });
        expect(editor.getCaret()).toEqual({ line: 1, character: 2 });
        expect(heard).toEqual([{ line: 1, character: 2 }]);
    });

    test('applies edits in the coordinates of the current text, as one step', () => {
        const { editor } = setup({ text: 'one\ntwo' });
        const range = (line: number, start: number, end: number) => ({ start: { line, character: start }, end: { line, character: end } });
        expect(
            editor.applyEdits([
                { range: range(0, 0, 3), text: 'uno' },
                { range: range(1, 0, 3), text: 'dos' }
            ])
        ).toBe(true);
        expect(editor.getText()).toBe('uno\ndos');
    });
});

describe('Tab', () => {
    test('inserts at the caret, indents a selection and unindents with Shift', () => {
        const { editor, press: key, type } = setup({ text: 'ab\ncd', indentation: { tabSize: 4, insertSpaces: true } });
        key('ArrowRight');
        key('Tab');
        expect(editor.getText()).toBe('a   b\ncd');
        key('ArrowDown', { shiftKey: true });
        key('Tab');
        expect(editor.getText()).toBe('    a   b\n    cd');
        key('Tab', { shiftKey: true });
        expect(editor.getText()).toBe('a   b\ncd');
        type('x');
    });

    test('steps over a closer the editor typed', () => {
        const { editor, press: key, type } = setup({ text: '', language: 'typescript' });
        type('f');
        type('(');
        type('1');
        key('Tab');
        type('x');
        expect(editor.getText()).toBe('f(1)x');
    });
});

describe('comments and Enter', () => {
    test('toggles a line comment by the language of the file and moves down', () => {
        const { editor, press: key } = setup({ text: 'a = 1\nb = 2', language: 'python' });
        key('/', { ctrlKey: true });
        expect(editor.getText()).toBe('# a = 1\nb = 2');
        expect(editor.getCaret()).toEqual({ line: 1, character: 2 });
    });

    test('continues a block comment and closes it on Enter', () => {
        const { editor, press: key, type } = setup({ text: '', language: 'typescript' });
        type('/');
        type('*');
        type('*');
        key('Enter');
        expect(editor.getText()).toBe('/**\n * \n */');
        expect(editor.getCaret()).toEqual({ line: 1, character: 3 });
    });
});

describe('the clipboard', () => {
    test('pastes a line copied from a bare caret above the line of the caret', () => {
        const { editor, press: key, clip } = setup({ text: 'one\ntwo\nthree' });
        key('ArrowDown');
        const copied = clip('copy');
        expect(copied).toBe('two\n');
        key('ArrowDown');
        clip('paste', copied);
        expect(editor.getText()).toBe('one\ntwo\ntwo\nthree');
        expect(editor.getCaret()).toEqual({ line: 3, character: 0 });
    });

    test('pastes a line cut from a bare caret as a line too, and a selection as it is', () => {
        const { editor, press: key, clip } = setup({ text: 'one\ntwo' });
        const cut = clip('cut');
        expect(cut).toBe('one\n');
        expect(editor.getText()).toBe('two');
        key('End');
        clip('paste', cut);
        expect(editor.getText()).toBe('one\ntwo');
        key('a', { ctrlKey: true });
        const selected = clip('copy');
        key('End', { ctrlKey: true });
        clip('paste', selected);
        expect(editor.getText()).toBe('one\ntwoone\ntwo');
    });

    test('moves a pasted block to the indentation of its line', () => {
        const { editor, press: key, clip } = setup({ text: 'function f() {\n    \n}', language: 'typescript' });
        key('ArrowDown');
        key('End');
        clip('paste', 'if (x) {\n    y;\n}');
        expect(editor.getText()).toBe('function f() {\n    if (x) {\n        y;\n    }\n}');
    });
});

describe('Extend Selection through the ranges of a language server', () => {
    const range = (startLine: number, startCharacter: number, endLine: number, endCharacter: number) => ({
        start: { line: startLine, character: startCharacter },
        end: { line: endLine, character: endCharacter }
    });

    /* A server answer takes a few turns of the event loop to get through the queue of presses. */
    const flush = async (): Promise<void> => {
        for (let i = 0; i < 20; i++) {
            await Promise.resolve();
        }
    };

    test('grows through the ranges it is given, one press after the other, and Shrink Selection walks back', async () => {
        const { editor, press: key } = setup({ text: 'call(one, two)\nnext' });
        const asked: unknown[] = [];
        editor.setSelectionRanges(async (positions) => {
            asked.push(positions);
            return [[range(0, 5, 0, 8), range(0, 5, 0, 13), range(0, 0, 1, 4)]];
        });
        editor.setCaret({ line: 0, character: 6 });
        key('ArrowUp', { altKey: true });
        key('ArrowUp', { altKey: true });
        await flush();
        // A quick second press grows from what the first made, and the first range that holds it and more is the next.
        expect(editor.getSelection()).toEqual(range(0, 5, 0, 13));
        expect(asked).toEqual([[{ line: 0, character: 6 }], [{ line: 0, character: 5 }]]);
        key('ArrowDown', { altKey: true });
        expect(editor.getSelection()).toEqual(range(0, 5, 0, 8));
    });

    test('grows by its own rule where the server has no ranges, and where it fails', async () => {
        const { editor, press: key } = setup({ text: 'one two', language: 'typescript' });
        editor.setSelectionRanges(async () => null);
        editor.setCaret({ line: 0, character: 5 });
        key('ArrowUp', { altKey: true });
        await flush();
        expect(editor.getSelection()).toEqual(range(0, 4, 0, 7));
        editor.setSelectionRanges(async () => {
            throw new Error('The server went away');
        });
        key('ArrowUp', { altKey: true });
        await flush();
        expect(editor.getSelection()).toEqual(range(0, 0, 0, 7));
    });

    test('leaves a selection alone when the text changed while the server answered', async () => {
        const { editor, press: key, type } = setup({ text: 'one two', language: 'typescript' });
        let answer: () => void = () => undefined;
        editor.setSelectionRanges(
            () =>
                new Promise((resolve) => {
                    answer = () => resolve([[range(0, 0, 0, 7)]]);
                })
        );
        editor.setCaret({ line: 0, character: 1 });
        key('ArrowUp', { altKey: true });
        await flush();
        type('X');
        answer();
        await flush();
        expect(editor.getText()).toBe('oXne two');
        expect(editor.getSelection()).toEqual(range(0, 2, 0, 2));
    });

    test("is the editor's own rule again once the provider is taken away", async () => {
        const { editor, press: key } = setup({ text: 'one two', language: 'typescript' });
        editor.setSelectionRanges(async () => [[range(0, 0, 0, 7)]]);
        editor.setSelectionRanges(null);
        editor.setCaret({ line: 0, character: 5 });
        key('ArrowUp', { altKey: true });
        expect(editor.getSelection()).toEqual(range(0, 4, 0, 7));
    });
});

describe('line commands', () => {
    test('runs a command on the editor by name', () => {
        const { editor } = setup({ text: 'a\nb', language: 'typescript' });
        expect(editor.runCommand('joinLines')).toBe(true);
        expect(editor.getText()).toBe('a b');
        expect(editor.runCommand('joinLines')).toBe(false);
    });

    test('starts a new line with Shift+Enter from anywhere on the line', () => {
        const { editor, press: key, type } = setup({ text: 'one two\nthree', language: 'typescript' });
        key('ArrowRight');
        key('Enter', { shiftKey: true });
        type('x');
        expect(editor.getText()).toBe('one two\nx\nthree');
    });
});

describe('typed handlers', () => {
    test('wraps the selection in a typed bracket or angle bracket', () => {
        const { editor, press: key, type } = setup({ text: 'foo', language: 'typescript' });
        key('a', { ctrlKey: true });
        type('<');
        expect(editor.getText()).toBe('<foo>');
        expect(editor.getSelection()).toEqual({ start: { line: 0, character: 1 }, end: { line: 0, character: 4 } });
    });

    test('puts a closing brace typed on a line of its own under its opener', () => {
        const { editor, press: key, type } = setup({ text: 'if (x) {\n    foo();\n    ', language: 'typescript' });
        key('End', { ctrlKey: true });
        type('}');
        expect(editor.getText()).toBe('if (x) {\n    foo();\n}');
    });

    test('takes the whitespace of the line above along when Backspace joins two lines', () => {
        const { editor, press: key } = setup({ text: 'foo   \nbar' });
        key('ArrowDown');
        key('Home');
        key('Home');
        key('Backspace');
        expect(editor.getText()).toBe('foobar');
    });
});

describe('smart keys', () => {
    test('are on at the start, except the camel humps', () => {
        const { editor, press: key, type } = setup({ text: '', language: 'typescript' });
        type('(');
        expect(editor.getText()).toBe('()');
        key('Tab');
        type('fooBar');
        key('ArrowLeft', { ctrlKey: true });
        type('X');
        expect(editor.getText()).toBe('()XfooBar');
    });

    test('stop at the camel humps when they are on', () => {
        const { editor, press: key, type } = setup({ text: 'fooBar', smartKeys: { camelHumps: true } });
        key('ArrowRight', { ctrlKey: true });
        type('X');
        expect(editor.getText()).toBe('fooXBar');
    });

    test('can leave out a pair or a wrap, now or later', () => {
        const { editor, press: key, type } = setup({ text: '', language: 'typescript', smartKeys: { autoPairBrackets: false } });
        type('(');
        expect(editor.getText()).toBe('(');
        editor.setSmartKeys({ surroundSelection: false });
        key('a', { ctrlKey: true });
        type('[');
        expect(editor.getText()).toBe('[');
        editor.setSmartKeys({ autoPairBrackets: true });
        type('{');
        expect(editor.getText()).toBe('[{}');
    });

    test('can leave out the indentation of Enter', () => {
        const { editor, press: key, type } = setup({ text: '', language: 'typescript', smartKeys: { smartIndentOnEnter: false } });
        type('{');
        key('Enter');
        expect(editor.getText()).toBe('{\n}');
        key('z', { ctrlKey: true });
        editor.setSmartKeys({ smartIndentOnEnter: true });
        key('Enter');
        expect(editor.getText()).toBe('{\n    \n}');
    });
});

describe('trackRange', () => {
    const range = (line: number, from: number, to: number) => ({ start: { line, character: from }, end: { line, character: to } });

    test('follows the range through typing before it and loses it to an edit inside it', () => {
        const { editor, type } = setup({ text: 'alpha beta\ngamma', line: 1, column: 1 });
        const tracked = editor.trackRange(range(0, 6, 10));
        editor.applyEdits([{ range: range(0, 0, 0), text: 'x\n' }]);
        expect(tracked.get()).toEqual(range(1, 6, 10));
        editor.setCaret({ line: 1, character: 8 });
        type('!');
        expect(tracked.get()).toBeNull();
    });

    test('survives text inserted at its ends and edits on the other lines', () => {
        const { editor } = setup({ text: 'alpha beta\ngamma' });
        const tracked = editor.trackRange(range(0, 6, 10));
        editor.applyEdits([{ range: range(0, 10, 10), text: '!' }]);
        expect(tracked.get()).toEqual(range(0, 6, 10));
        editor.applyEdits([{ range: range(0, 6, 6), text: '>' }]);
        expect(tracked.get()).toEqual(range(0, 7, 11));
        editor.setText('alpha >beta!\nGAMMA');
        expect(tracked.get()).toEqual(range(0, 7, 11));
        expect(editor.textInRange(tracked.get()!)).toBe('beta');
    });

    test('stays lost after undo, and a disposed range is null', () => {
        const { editor, press: key } = setup({ text: 'alpha beta' });
        const lost = editor.trackRange(range(0, 6, 10));
        const disposed = editor.trackRange(range(0, 0, 5));
        disposed.dispose();
        editor.applyEdits([{ range: range(0, 7, 8), text: 'E' }]);
        key('z', { ctrlKey: true });
        expect(editor.getText()).toBe('alpha beta');
        expect(lost.get()).toBeNull();
        expect(disposed.get()).toBeNull();
    });
});

describe('setRemoteCursors', () => {
    const text = Array.from({ length: 12 }, (_, i) => `line ${i}`).join('\n');
    const carets = (host: HTMLElement) =>
        [...host.querySelectorAll('.se-remote-caret')].map((caret) => {
            const element = caret as HTMLElement;
            const label = element.querySelector('.se-remote-label') as HTMLElement;
            return `${label.textContent}@${element.style.left},${element.style.top}${label.dataset.below ? ' below' : ''}`;
        });

    test('draws a caret with its name, and the name under it on the first line where there is no room above', () => {
        const { editor, host } = setup({ text });
        editor.setRemoteCursors([
            { id: 'a', position: { line: 5, character: 3 }, name: 'Claude Code', color: '--agent-1' },
            { id: 'b', position: { line: 0, character: 0 }, name: 'Codex', color: '#336699' }
        ]);
        expect(carets(host)).toEqual(['Claude Code@23px,100px', 'Codex@0px,0px below']);
        const label = host.querySelector('.se-remote-label') as HTMLElement;
        expect(label.style.background).toBe('var(--agent-1)');
        expect(host.querySelector('.se-remote')!.getAttribute('aria-hidden')).toBe('true');
    });

    test('follows its text through an edit, and is gone once set again', () => {
        const { editor, host } = setup({ text });
        editor.setRemoteCursors([{ id: 'a', position: { line: 5, character: 0 }, name: 'Claude Code', color: '--agent-1' }]);
        editor.applyEdits([{ range: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } }, text: 'new\n' }]);
        expect(carets(host)).toEqual(['Claude Code@0px,120px']);
        editor.setRemoteCursors([]);
        expect(carets(host)).toEqual([]);
    });

    test('draws nothing for a cursor on a line a fold hides', () => {
        const { editor, host } = setup({
            text: 'one\nfunction a() {\n    body();\n}\ntwo',
            language: 'typescript',
            folds: { collapsed: [{ startLine: 1, endLine: 3 }], custom: [] }
        });
        editor.setRemoteCursors([{ id: 'a', position: { line: 2, character: 0 }, name: 'Claude Code', color: '--agent-1' }]);
        expect(carets(host)).toEqual([]);
        editor.setRemoteCursors([{ id: 'a', position: { line: 1, character: 0 }, name: 'Claude Code', color: '--agent-1' }]);
        expect(carets(host)).toEqual(['Claude Code@0px,20px']);
    });

    test('leaves the real caret and selection alone', () => {
        const { editor } = setup({ text });
        editor.setCaret({ line: 2, character: 1 });
        editor.setRemoteCursors([{ id: 'a', position: { line: 5, character: 0 }, name: 'Claude Code', color: '--agent-1' }]);
        expect(editor.getCaret()).toEqual({ line: 2, character: 1 });
    });
});
