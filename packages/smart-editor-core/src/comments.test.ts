import { describe, expect, it } from 'bun:test';
import { DocumentModel } from './document.ts';
import type { CommandOptions, EditorCommand } from './types.ts';

/* `¦` marks a caret, `[` and `]` a selection. */
function parse(source: string): { text: string; selections: { anchor: number; head: number }[] } {
    const open = source.indexOf('[');
    const close = source.indexOf(']');
    if (open >= 0 && close >= 0) {
        const text = source.slice(0, open) + source.slice(open + 1, close) + source.slice(close + 1);
        return { text, selections: [{ anchor: open, head: close - 1 }] };
    }
    const caret = source.indexOf('¦');
    return { text: source.replace('¦', ''), selections: [{ anchor: caret, head: caret }] };
}

function render(model: DocumentModel): string {
    const [selection] = model.getSelections();
    const text = model.getText();
    if (selection!.anchor === selection!.head) {
        return text.slice(0, selection!.head) + '¦' + text.slice(selection!.head);
    }
    const from = Math.min(selection!.anchor, selection!.head);
    const to = Math.max(selection!.anchor, selection!.head);
    return `${text.slice(0, from)}[${text.slice(from, to)}]${text.slice(to)}`;
}

function run(command: EditorCommand, source: string, expected: string, options: CommandOptions = {}): void {
    const initial = parse(source);
    const model = new DocumentModel(initial.text);
    model.setSelections(initial.selections);
    model.execute(command, { language: 'typescript', ...options });
    expect(render(model)).toBe(expected);
}

const line = (source: string, expected: string, options: CommandOptions = {}): void => run('toggleLineComment', source, expected, options);
const block = (source: string, expected: string, options: CommandOptions = {}): void => run('toggleBlockComment', source, expected, options);

describe('line comments', () => {
    it('comments a line and moves the caret down one', () => {
        line('foo¦\nbar', '// foo\nbar¦');
        line('fo¦o\nbar', '// foo\nbar¦');
    });

    it('takes the comment off again and keeps the caret in step', () => {
        line('// foo¦\nbar', 'foo\nbar¦');
        line('//foo¦\nbar', 'foo\nbar¦');
    });

    it('puts the markers at the smallest indentation', () => {
        line('[    a\n  b\n      c]', '[  //   a\n  // b\n  //     c]');
        line('[\ta\n\t\tb]', '[\t// a\n\t// \tb]');
    });

    it('comments blank lines of a selection with a bare marker and decides by the others', () => {
        line('[a\n\nb]', '[// a\n//\n// b]');
        line('[// a\n//\n// b]', '[a\n\nb]');
        line('[// a\n\n// b]', '[a\n\nb]');
        line('[// a\nb]', '[// // a\n// b]');
    });

    it('aligns with a comment on the line above', () => {
        line('    // x\n        foo¦', '    // x\n    //     foo¦');
    });

    it('starts a comment on an empty line and puts the caret after it', () => {
        line('foo {\n¦\n}', 'foo {\n// ¦\n}');
        line('foo {\n    ¦\n}', 'foo {\n//     ¦\n}');
    });

    it('keeps a selection of whole lines whole', () => {
        line('[one\ntwo\n]three', '[// one\n// two\n]three');
        line('o[ne\ntw]o', '// o[ne\n// tw]o');
    });

    it('keeps the direction of a selection', () => {
        const model = new DocumentModel('  one\n\ttwo');
        model.setSelections([{ anchor: 10, head: 0 }]);
        model.execute('toggleLineComment');
        expect(model.getText()).toBe('  // one\n\t// two');
        expect(model.getSelections()[0]!.anchor).toBeGreaterThan(model.getSelections()[0]!.head);
    });

    it('moves every caret that is alone on its lines', () => {
        const model = new DocumentModel('a\nb\nc\nd');
        model.setSelections([
            { anchor: 0, head: 0 },
            { anchor: 4, head: 4 }
        ]);
        model.execute('toggleLineComment');
        expect(model.getText()).toBe('// a\nb\n// c\nd');
        expect(model.getSelections().map((selection) => selection.head)).toEqual([6, 13]);
    });

    it('leaves the last line where it is', () => {
        line('a\nb¦', 'a\n// b¦');
    });

    it('comments with the marker of the language', () => {
        line('x = 1¦\ny', '# x = 1\ny¦', { language: 'python' });
        line('select 1¦\ny', '-- select 1\ny¦', { language: 'sql' });
        line('key: 1¦\ny', '# key: 1\ny¦', { language: 'yaml' });
        line('echo¦\ny', '# echo\ny¦', { language: 'shellscript' });
        line('{ "a": 1¦ }\ny', '// { "a": 1 }\ny¦', { language: 'jsonc' });
        line('$a = 1;¦\ny', '// $a = 1;\ny¦', { language: 'php' });
    });

    it('has no marker in plain text', () => {
        const model = new DocumentModel('text');
        expect(model.execute('toggleLineComment', { language: 'plaintext' })).toBe(false);
        expect(model.getText()).toBe('text');
    });

    it('wraps each line where the language has only block comments', () => {
        line('a { color: red; }¦\nb', '/* a { color: red; } */\nb¦', { language: 'css' });
        line('/* a { color: red; } */¦\nb', 'a { color: red; }\nb¦', { language: 'css' });
        line('[a\n\nb]', '[/* a */\n\n/* b */]', { language: 'css' });
        line('<div>¦\nb', '<!-- <div> -->\nb¦', { language: 'html' });
        line('  <div>¦\nx', '  <!-- <div> -->\nx¦', { language: 'html' });
        line('# title¦\nb', '<!-- # title -->\nb¦', { language: 'markdown' });
    });

    it('picks the markers of a Vue region by the line', () => {
        const file = '<template>\n  <div />\n</template>\n<script setup>\nfoo()\n</script>\n<style>\na {}\n</style>';
        const at = (text: string): string => file.replace(text, `${text}¦`);
        line(at('<div />'), file.replace('<div />', '<!-- <div /> -->').replace('</template>', '</template>¦'), { language: 'vue' });
        line(at('foo()'), file.replace('foo()', '// foo()').replace('</script>', '</script¦>'), { language: 'vue' });
        line(at('a {}'), file.replace('a {}', '/* a {} */').replace('</style>', '</style>¦'), { language: 'vue' });
    });
});

describe('block comments', () => {
    it('wraps a selection and takes the markers off again', () => {
        block('foo [bar] baz', 'foo [/* bar */] baz');
        block('foo [/* bar */] baz', 'foo [bar] baz');
        block('foo /* bar ¦*/ baz', 'foo bar¦ baz');
    });

    it('opens an empty comment at the caret', () => {
        block('foo¦', 'foo/* ¦ */');
    });

    it('puts a selection of whole lines between lines of their own', () => {
        block('[a\n  b\n]c', '[/*\na\n  b\n*/\n]c');
        block('[  a\n  b\n]c', '[  /*\n  a\n  b\n  */\n]c');
    });

    it('uses the markers of the language and skips what has none', () => {
        block('[<div>]\nx', '[<!-- <div> -->]\nx', { language: 'html' });
        block('[<!-- x -->]\ny', '[x]\ny', { language: 'html' });
        block('[a { }]\ny', '[/* a { } */]\ny', { language: 'css' });
        block('[x]\ny', '[x]\ny', { language: 'python' });
    });

    it('refuses a selection that holds a closing marker or cuts through a comment', () => {
        block('[a /* b */ c]\nx', '[a /* b */ c]\nx');
        block('/* a [b] c */\nx', '/* a [b] c */\nx');
    });

    it('uses the markers of the region in a Vue file', () => {
        block('<script>\n[foo()]\n</script>', '<script>\n[/* foo() */]\n</script>', { language: 'vue' });
        block('<template>\n[<div/>]\n</template>', '<template>\n[<!-- <div/> -->]\n</template>', { language: 'vue' });
    });
});
