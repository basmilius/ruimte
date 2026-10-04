import { describe, expect, it } from 'bun:test';
import { DocumentModel } from './document.ts';
import type { CommandOptions, EditorCommand } from './types.ts';

/* `¦` marks a caret, `«` and `»` a selection. */
function parse(source: string): { text: string; selection: { anchor: number; head: number } } {
    const open = source.indexOf('«');
    const close = source.indexOf('»');
    if (open >= 0 && close >= 0) {
        return { text: source.slice(0, open) + source.slice(open + 1, close) + source.slice(close + 1), selection: { anchor: open, head: close - 1 } };
    }
    const caret = source.indexOf('¦');
    return { text: source.replace('¦', ''), selection: { anchor: caret, head: caret } };
}

function render(model: DocumentModel): string {
    const selection = model.getSelections()[0]!;
    const text = model.getText();
    if (selection.anchor === selection.head) {
        return text.slice(0, selection.head) + '¦' + text.slice(selection.head);
    }
    const from = Math.min(selection.anchor, selection.head);
    const to = Math.max(selection.anchor, selection.head);
    return `${text.slice(0, from)}«${text.slice(from, to)}»${text.slice(to)}`;
}

function run(command: EditorCommand, source: string, expected: string, options: CommandOptions = {}): void {
    const initial = parse(source);
    const model = new DocumentModel(initial.text);
    model.setSelections([initial.selection]);
    model.execute(command, { language: 'typescript', ...options });
    expect(render(model)).toBe(expected);
}

describe('start new line', () => {
    it('opens a line below, whatever the caret splits, indented as Enter would', () => {
        run('startNewLine', 'foo(¦a)', 'foo(a)\n¦');
        run('startNewLine', '  fo¦o', '  foo\n  ¦');
        run('startNewLine', 'if (x) {¦', 'if (x) {\n    ¦\n}');
    });

    it('opens a line above at the indentation of the line', () => {
        run('startNewLineBefore', '  fo¦o', '  ¦\n  foo');
        run('startNewLineBefore', 'if (x) {\n}¦', 'if (x) {\n    ¦\n}');
        run('startNewLineBefore', 'a¦', '¦\na');
    });
});

describe('split line', () => {
    it('breaks the line and leaves the caret in front of the break', () => {
        run('splitLine', 'foo¦bar', 'foo¦\nbar');
        run('splitLine', 'if (x) {¦', 'if (x) {¦\n    \n}');
        run('splitLine', '    ¦foo', '    ¦\n    foo');
        run('splitLine', '¦foo', '¦\nfoo');
    });
});

describe('join lines', () => {
    it('joins with the next line by one space and puts the caret where they met', () => {
        run('joinLines', 'a¦\n    b', 'a¦ b');
        run('joinLines', 'a  ¦\n  b', 'a¦ b');
        run('joinLines', 'foo¦\n\n\nbar', 'foo¦ bar');
    });

    it('leaves no space after an opener or before a closer, a comma or a dot', () => {
        run('joinLines', 'foo(¦\n    a,\n    b\n)', 'foo(¦a,\n    b\n)');
        run('joinLines', 'foo(\n    a¦\n)', 'foo(\n    a¦)');
        run('joinLines', 'a¦\n, b', 'a¦, b');
        run('joinLines', 'foo¦\n    .bar()', 'foo¦.bar()');
        run('joinLines', 'if (a)¦\n{', 'if (a)¦ {');
    });

    it('joins every line of a selection and collapses it at the end', () => {
        run('joinLines', '«a\n  b\n  c»', 'a b c¦');
        run('joinLines', '«a\n  b\n»c', 'a b\n¦c');
    });

    it('drops the second marker of comment lines it joins', () => {
        run('joinLines', '// a¦\n// b', '// a¦ b');
        run('joinLines', '    // a¦\n    //b\n    // c', '    // a¦ b\n    // c');
        run('joinLines', '# a¦\n# b', '# a¦ b', { language: 'python' });
    });

    it('turns the comment at the end of a line into a block comment before code follows it', () => {
        run('joinLines', 'x = 1; // note¦\ny = 2;', 'x = 1; /* note */¦ y = 2;');
        run('joinLines', 'x = 1; //note¦\ny = 2;', 'x = 1; /*note*/¦ y = 2;');
        run('joinLines', 'x = 1; // a */ b¦\ny = 2;', 'x = 1; // a */ b¦ y = 2;');
    });

    it('does nothing on the last line', () => {
        const model = new DocumentModel('a\nb');
        model.setSelections([{ anchor: 3, head: 3 }]);
        expect(model.execute('joinLines')).toBe(false);
        expect(model.getText()).toBe('a\nb');
    });

    it('drops a blank line it is on', () => {
        run('joinLines', 'x\n¦\n  y', 'x\n  ¦y');
    });
});

describe('toggle case', () => {
    it('lowers text with a capital and raises text without', () => {
        run('toggleCase', '«Hello World»', '«hello world»');
        run('toggleCase', '«hello»', '«HELLO»');
        run('toggleCase', '«hello World»', '«hello world»');
        run('toggleCase', '«HELLO»', '«hello»');
    });

    it('takes the word at a caret and leaves it selected', () => {
        run('toggleCase', 'foo¦Bar baz', '«foobar» baz');
        run('toggleCase', 'foo¦ baz', '«FOO» baz');
        run('toggleCase', 'a ¦ b', 'a ¦ b');
    });

    it('has one answer for every caret', () => {
        const model = new DocumentModel('ab CD');
        model.setSelections([
            { anchor: 1, head: 1 },
            { anchor: 4, head: 4 }
        ]);
        model.execute('toggleCase');
        expect(model.getText()).toBe('ab cd');
    });

    it('leaves the escapes of a string as they are', () => {
        run('toggleCase', '"«hello\\nworld\\u00e9»"', '"«HELLO\\nWORLD\\u00e9»"');
    });
});

describe('auto-indent lines', () => {
    it('indents by the brackets that are open', () => {
        run('autoIndentLines', '«function f() {\nfoo();\nif (x) {\nbar();\n}\n}»', '«function f() {\n    foo();\n    if (x) {\n        bar();\n    }\n}»');
        run('autoIndentLines', '«foo({\na: 1,\nb: [\n2\n]\n})»', '«foo({\n    a: 1,\n    b: [\n        2\n    ]\n})»');
    });

    it('measures from the line a bracket opened on', () => {
        run('autoIndentLines', '    if (x) {\n«foo();\n    }»', '    if (x) {\n«        foo();\n    }»');
    });

    it('puts the lines of a case under their label', () => {
        run(
            'autoIndentLines',
            '«switch (x) {\ncase 1:\nfoo();\nbreak;\ncase 2:\nbar();\n}»',
            '«switch (x) {\n    case 1:\n        foo();\n        break;\n    case 2:\n        bar();\n}»'
        );
    });

    it('goes in once after an unfinished statement and back after it', () => {
        run('autoIndentLines', '«const a =\n1 +\n2;\nfoo();»', '«const a =\n    1 +\n    2;\nfoo();»');
        run('autoIndentLines', '«if (x)\nfoo();\nbar();»', '«if (x)\n    foo();\nbar();»');
    });

    it('works on the line of a caret and leaves comments, strings and other languages be', () => {
        run('autoIndentLines', 'if (x) {\n      a;¦\n}', 'if (x) {\n    a;¦\n}');
        run('autoIndentLines', '«{\n/*\n   * x\n  */\n`a\n b`\n}»', '«{\n    /*\n   * x\n  */\n    `a\n b`\n}»');
        const python = new DocumentModel('def f():\nx');
        python.setSelections([{ anchor: 0, head: 10 }]);
        expect(python.execute('autoIndentLines', { language: 'python' })).toBe(false);
    });
});
