import { describe, expect, it } from 'bun:test';
import { DocumentModel, type TypeTextOptions } from './document.ts';

/* `¦` marks a caret, `«` and `»` a selection. */
function parse(source: string): { text: string; anchor: number; head: number } {
    const open = source.indexOf('«');
    const close = source.indexOf('»');
    if (open >= 0 && close >= 0) {
        return { text: source.slice(0, open) + source.slice(open + 1, close) + source.slice(close + 1), anchor: open, head: close - 1 };
    }
    const caret = source.indexOf('¦');
    return { text: source.replace('¦', ''), anchor: caret, head: caret };
}

function render(model: DocumentModel): string {
    const { anchor, head } = model.getSelections()[0]!;
    const text = model.getText();
    if (anchor === head) {
        return text.slice(0, head) + '¦' + text.slice(head);
    }
    const from = Math.min(anchor, head);
    const to = Math.max(anchor, head);
    return `${text.slice(0, from)}«${text.slice(from, to)}»${text.slice(to)}`;
}

function type(source: string, typed: string, expected: string, options: TypeTextOptions = {}): void {
    const initial = parse(source);
    const model = new DocumentModel(initial.text);
    model.setSelections([{ anchor: initial.anchor, head: initial.head }]);
    model.typeText(typed, { language: 'typescript', ...options });
    expect(render(model)).toBe(expected);
}

describe('typing over a selection', () => {
    it.each([
        ['«foo»', '(', '(«foo»)'],
        ['«foo»', '<', '<«foo»>'],
        ['«foo»', '"', '"«foo»"'],
        ['«foo»', '`', '`«foo»`'],
        ['a «b c» d', '{', 'a {«b c»} d'],
        ['«a\nb»', '[', '[«a\nb»]']
    ])('wraps %s in %s', (source, typed, expected) => type(source, typed, expected));

    it('keeps the direction of the selection', () => {
        const model = new DocumentModel('foo');
        model.setSelections([{ anchor: 3, head: 0 }]);
        model.typeText('(');
        expect(model.getText()).toBe('(foo)');
        expect(model.getSelections()).toEqual([{ anchor: 4, head: 1 }]);
    });

    it('replaces an operator that is typed over with a comparison sign', () => {
        type('a «==» b', '<', 'a <¦ b');
        type('a «<=» b', '<', 'a <¦ b');
        type('a «!=» b', '<', 'a <¦ b');
        type('a «foo» b', '<', 'a <«foo»> b');
        type('"a «==» b"', '<', '"a <«==»> b"');
    });

    it('swaps the delimiters of a selection that has them', () => {
        type('«"foo"»', "'", "'«foo»'");
        type('«(foo)»', '[', '[«foo»]');
        type('«(foo)»', '(', '(«(foo)»)');
        type('«"a"b"»', "'", `'«"a"b"»'`);
    });

    it('swaps the quotes of a string when one of them is selected', () => {
        type('x = «"»foo";', "'", "x = '¦foo';");
        type('x = "foo«"»;', "'", "x = 'foo'¦;");
        type('x = «`»a ${b}`;', '"', 'x = "¦a ${b}";');
    });

    it('escapes and unescapes the quotes inside the string it swaps', () => {
        type(`x = «"»it's \\"x\\"";`, "'", `x = '¦it\\'s "x"';`);
        type(`x = «'»a \\'b\\' "c"';`, '"', `x = "¦a 'b' \\"c\\"";`);
    });

    it('does not swap a quote that is not the quote of a string', () => {
        type('a «"» b', "'", `a '«"»' b`);
    });

    it('wraps without pairing and in plain text, and not when it is off', () => {
        type('«foo»', '(', '(«foo»)', { autoClosingPairs: false });
        type('«foo»', '(', '(«foo»)', { language: 'plaintext' });
        type('«foo»', '(', '(¦', { surroundSelection: false });
        type('«foo»', '"', '"«foo»"', { autoClosingQuotes: false });
    });
});

describe('pairing', () => {
    it('pairs a bracket only when it would have no closer of its own', () => {
        type('x = ¦ + y', '(', 'x = (¦) + y');
        type('x = ¦ + y)', '(', 'x = (¦ + y)');
        type('function f() ¦', '{', 'function f() {¦}');
        type('function f() ¦\n}', '{', 'function f() {¦\n}');
        type('const a = [¦, 2', '[', 'const a = [[¦], 2');
        type('f(¦', '(', 'f((¦)');
    });

    it('pairs a quote unless an identifier character follows, or the same quote', () => {
        type('¦.length', '"', '"¦".length');
        type('x = ¦;', '"', 'x = "¦";');
        type('¦foo', '"', '"¦foo');
        type('a ¦"b"', '"', 'a "¦"b"');
        type('foo¦', '"', 'foo"¦');
    });

    it('does not pair in plain text', () => {
        type('¦', '(', '(¦', { language: 'plaintext' });
        type('¦', '"', '"¦', { language: 'text' });
        type('(¦)', ')', '()¦)', { language: 'plaintext' });
    });

    it('leaves brackets and quotes to their own settings', () => {
        type('¦', '(', '(¦', { autoClosingBrackets: false });
        type('¦', '"', '"¦"', { autoClosingBrackets: false });
        type('¦', '"', '"¦', { autoClosingQuotes: false });
        type('¦', '(', '(¦)', { autoClosingQuotes: false });
        type('(¦)', ')', '()¦', { autoClosingQuotes: false });
    });

    it('types the third quote of a Python docstring as it is', () => {
        const model = new DocumentModel();
        for (const character of '"""') {
            model.typeText(character, { language: 'python' });
        }
        expect(model.getText()).toBe('"""');
        model.typeText('x', { language: 'python' });
        for (const character of '"""') {
            model.typeText(character, { language: 'python' });
        }
        expect(model.getText()).toBe('"""x"""');
        const single = new DocumentModel();
        for (const character of "'''") {
            single.typeText(character, { language: 'python' });
        }
        expect(single.getText()).toBe("'''");
        type("x = ''¦", "'", "x = '''¦", { language: 'python' });
    });

    it('still pairs the empty string of Python and types over its closer', () => {
        const model = new DocumentModel();
        model.typeText('"', { language: 'python' });
        expect(model.getText()).toBe('""');
        model.typeText('"', { language: 'python' });
        expect(model.getText()).toBe('""');
        expect(model.getSelections()[0]!.head).toBe(2);
    });
});

describe('a closing bracket typed on a line of its own', () => {
    it('goes back to the indentation of the line its opener is on', () => {
        type('if (x) {\n    foo();\n    ¦', '}', 'if (x) {\n    foo();\n}¦');
        type('    if (x) {\n        foo();\n        ¦', '}', '    if (x) {\n        foo();\n    }¦');
        type('foo(\n    a,\n    ¦', ')', 'foo(\n    a,\n)¦');
        type('x = [\n    1,\n    ¦', ']', 'x = [\n    1,\n]¦');
        type('if (x) {\n    foo();\n¦', '}', 'if (x) {\n    foo();\n}¦');
    });

    it('stays where it is with text before it, in a string or when smart indentation is off', () => {
        type('if (x) {\n    foo();\n    bar¦', '}', 'if (x) {\n    foo();\n    bar}¦');
        type('x = "{\n    ¦', '}', 'x = "{\n    }¦');
        type('if (x) {\n    foo();\n    ¦', '}', 'if (x) {\n    foo();\n    }¦', { smartEnter: false });
    });

    it('is one undo step with the typed character', () => {
        const model = new DocumentModel('if (x) {\n    foo();\n    ');
        model.setSelections([{ anchor: model.getLength(), head: model.getLength() }]);
        model.typeText('}', { language: 'typescript' });
        model.undo();
        expect(model.getText()).toBe('if (x) {\n    foo();\n    ');
    });
});

describe('backspace at the start of a line', () => {
    it('joins with the line above and takes the whitespace that trailed it', () => {
        const model = new DocumentModel('foo   \nbar');
        model.setSelections([{ anchor: 7, head: 7 }]);
        model.execute('smartBackspace');
        expect(model.getText()).toBe('foobar');
        expect(model.getSelections()).toEqual([{ anchor: 3, head: 3 }]);
        const tabbed = new DocumentModel('foo\t \r\nbar');
        tabbed.setSelections([{ anchor: 7, head: 7 }]);
        tabbed.execute('smartBackspace');
        expect(tabbed.getText()).toBe('foobar');
    });

    it('takes a line of whitespace entirely and leaves the text of the line alone', () => {
        const model = new DocumentModel('a\n    \n  b');
        model.setSelections([{ anchor: 7, head: 7 }]);
        model.execute('smartBackspace');
        expect(model.getText()).toBe('a\n  b');
        expect(model.getSelections()).toEqual([{ anchor: 2, head: 2 }]);
    });

    it('does not do this for the first line or a caret in the middle of one', () => {
        const model = new DocumentModel('foo  \nbar');
        model.setSelections([{ anchor: 0, head: 0 }]);
        expect(model.execute('smartBackspace')).toBe(false);
        model.setSelections([{ anchor: 8, head: 8 }]);
        model.execute('smartBackspace');
        expect(model.getText()).toBe('foo  \nbr');
    });
});
