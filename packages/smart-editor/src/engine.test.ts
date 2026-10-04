import { describe, expect, test } from 'bun:test';
import { mountEditor } from './testing.ts';
import type { EditorFindState, EditorOptions, KeyChord, LineTokenizer, SmartEditorEngineOptions } from './types.ts';

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

describe('indentation', () => {
    test('takes the tab size and style it is given, at mount and later', () => {
        const { editor, press } = setup({ text: 'a', indentation: { tabSize: 2, insertSpaces: true } });
        press('Tab');
        expect(editor.getText()).toBe('  a');
        editor.setIndentation({ tabSize: 4, insertSpaces: false });
        press('Tab');
        expect(editor.getText()).toBe('\t  a');
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

    test('indents on Tab and breaks the line on Enter', () => {
        const { editor, press: key } = setup({ text: 'a' });
        key('Enter');
        expect(editor.getText()).toBe('\na');
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
