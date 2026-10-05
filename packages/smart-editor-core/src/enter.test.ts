import { describe, expect, it } from 'bun:test';
import { DocumentModel } from './document.ts';
import type { CommandOptions } from './types.ts';

function marked(text: string): { text: string; offset: number } {
    const offset = text.indexOf('¦');
    if (offset < 0) {
        throw new Error('Caret marker is missing.');
    }
    return { text: text.replace('¦', ''), offset };
}

function enter(source: string, expected: string, options: CommandOptions = {}): void {
    const initial = marked(source);
    const model = new DocumentModel(initial.text);
    model.setSelections([{ anchor: initial.offset, head: initial.offset }]);
    model.execute('insertNewline', { language: 'typescript', ...options });
    const result = marked(expected);
    expect(model.getText()).toBe(result.text);
    expect(model.getSelections()).toEqual([{ anchor: result.offset, head: result.offset }]);
}

describe('Enter after code that a comment trails', () => {
    it('indents and closes as if the comment were not there', () => {
        enter('function f() { // note¦', 'function f() { // note\n    ¦\n}');
        enter('    if (x) { // note¦', '    if (x) { // note\n        ¦\n    }');
        enter('foo(function () { // note¦', 'foo(function () { // note\n    ¦\n}');
        enter('const a = [ // note¦', 'const a = [ // note\n    ¦');
        enter('a = // note¦', 'a = // note\n    ¦');
        enter('if (x) // note¦', 'if (x) // note\n    ¦');
        enter('case 1: // note¦', 'case 1: // note\n    ¦');
        enter('<div> // note¦', '<div> // note\n    ¦', { language: 'tsx' });
    });

    it('does the same for hash comments', () => {
        enter('if x:  # note¦', 'if x:  # note\n    ¦', { language: 'python' });
        enter('def f():  ## note¦', 'def f():  ## note\n    ¦', { language: 'python' });
        enter('key:  # note¦', 'key:  # note\n    ¦', { language: 'yaml' });
        enter('x = 1  # note¦', 'x = 1  # note\n¦', { language: 'python' });
    });

    it('leaves a comment that is a line of its own to the comment rules', () => {
        enter('// note¦', '// note\n¦');
    });
});

describe('Enter in a line comment', () => {
    it.each([
        ['// foo¦bar', '// foo\n// ¦bar'],
        ['    // foo¦bar', '    // foo\n    // ¦bar'],
        ['//   foo¦ bar', '//   foo\n//   ¦bar'],
        ['// foo¦', '// foo\n¦'],
        ['// foo¦   ', '// foo\n¦'],
        ['foo(); // a¦b', 'foo(); // a\n// ¦b'],
        ['    foo(); // a¦b', '    foo(); // a\n    // ¦b'],
        ['// foo¦// bar', '// foo\n¦// bar'],
        ['//¦ foo', '//\n// ¦foo'],
        ['/// doc¦more', '/// doc\n/// ¦more']
    ])('continues %s', (source, expected) => enter(source, expected));

    it('uses the hash of languages that comment with it', () => {
        enter('# foo¦bar', '# foo\n# ¦bar', { language: 'python' });
        enter('x = 1  # a¦b', 'x = 1  # a\n# ¦b', { language: 'python' });
    });

    it('leaves a hash alone in TypeScript', () => {
        enter('foo # a¦b', 'foo # a\n¦b');
    });
});

describe('Enter in a block comment', () => {
    it.each([
        ['/**¦', '/**\n * ¦\n */'],
        ['/*¦', '/*\n * ¦\n */'],
        ['    /**¦', '    /**\n     * ¦\n     */'],
        ['\t/**¦', '\t/**\n\t * ¦\n\t */'],
        ['foo(); /**¦', 'foo(); /**\n        * ¦\n        */'],
        ['    foo(); /*¦', '    foo(); /*\n            * ¦\n            */'],
        ['/** foo¦bar', '/** foo\n * ¦bar\n */'],
        ['/*¦\nfoo();\n/* other */', '/*\n * ¦\n */\nfoo();\n/* other */'],
        ['/**\n * foo¦', '/**\n * foo\n * ¦\n */'],
        ['/**\n * foo\n * bar¦', '/**\n * foo\n * bar\n * ¦\n */']
    ])('closes and continues %s', (source, expected) => enter(source, expected));

    it.each([
        ['/**\n * foo¦\n */', '/**\n * foo\n * ¦\n */'],
        ['    /**\n     * foo¦\n     */', '    /**\n     * foo\n     * ¦\n     */'],
        ['/**\n *   foo¦\n */', '/**\n *   foo\n *   ¦\n */'],
        ['/*\n * foo¦\n */', '/*\n * foo\n * ¦\n */'],
        ['/**¦\n * foo\n */', '/**\n * ¦\n * foo\n */'],
        ['/** foo¦ bar */', '/** foo\n * ¦bar */'],
        ['/**\n * foo¦bar\n */', '/**\n * foo\n * ¦bar\n */'],
        ['/**\n * a¦\n * b\n */', '/**\n * a\n * ¦\n * b\n */']
    ])('keeps the stars of a finished comment in line: %s', (source, expected) => enter(source, expected));

    it('does not add a star to a plain block comment', () => {
        enter('/* a¦\nb */', '/* a\n¦\nb */');
        enter('/* a\nb¦ */', '/* a\nb\n¦*/');
    });

    it('does not continue a block comment where the language has none', () => {
        enter('# a¦', '# a\n¦', { language: 'python' });
        enter('<!-- a¦', '<!-- a\n¦', { language: 'html' });
    });

    it('closes a comment in a Vue script and not in its template', () => {
        enter('<script>\n/**¦', '<script>\n/**\n * ¦\n */', { language: 'vue' });
    });
});

describe('Enter in a string', () => {
    it.each([
        ['const a = "foo¦bar";', 'const a = "foo" +\n    "¦bar";'],
        ["const a = 'foo¦bar';", "const a = 'foo' +\n    '¦bar';"],
        ['const a = "foo¦";', 'const a = "foo" +\n    "¦";'],
        ['const a = "¦foo";', 'const a = "" +\n    "¦foo";'],
        ['const a = "foo\\¦nbar";', 'const a = "foo\\n" +\n    "¦bar";'],
        ['    call("foo¦bar");', '    call("foo" +\n        "¦bar");']
    ])('splits %s', (source, expected) => enter(source, expected));

    it('uses the concatenation of the language', () => {
        enter('$a = "foo¦bar";', '$a = "foo" .\n    "¦bar";', { language: 'php' });
        enter('val a = "foo¦bar"', 'val a = "foo" +\n    "¦bar"', { language: 'kotlin' });
    });

    it('stays on the line of a string that is already continued', () => {
        enter('const a =\n    "foo¦bar";', 'const a =\n    "foo" +\n    "¦bar";');
        enter('const a = "x" +\n    "foo¦bar";', 'const a = "x" +\n    "foo" +\n    "¦bar";');
    });

    it('leaves template literals, unfinished strings and other languages alone', () => {
        enter('const a = `foo¦bar`;', 'const a = `foo\n¦bar`;');
        enter('const a = "foo¦', 'const a = "foo\n¦');
        enter('a = "foo¦bar"', 'a = "foo\n¦bar"', { language: 'python' });
    });
});

describe('Enter in a string that is not a string expression', () => {
    it('breaks the line plainly in a JSX attribute value and still splits a string in an expression', () => {
        const tsx = { language: 'tsx' };
        enter('const a = <div className="foo¦bar" />;', 'const a = <div className="foo\n¦bar" />;', tsx);
        enter("const a = (\n    <Foo\n        title='foo¦bar'\n    />\n);", "const a = (\n    <Foo\n        title='foo\n        ¦bar'\n    />\n);", tsx);
        enter('const a = <div title={"foo¦bar"} />;', 'const a = <div title={"foo" +\n    "¦bar"} />;', tsx);
        enter('const a = "foo¦bar";', 'const a = "foo" +\n    "¦bar";', tsx);
    });

    it('breaks the line plainly in the path of an import, a require or an export from', () => {
        enter('import x from "./foo¦bar";', 'import x from "./foo\n¦bar";');
        enter('import "./foo¦bar";', 'import "./foo\n¦bar";');
        enter("import { a } from './foo¦bar';", "import { a } from './foo\n¦bar';");
        enter('export * from "./foo¦bar";', 'export * from "./foo\n¦bar";');
        enter('const x = require("./foo¦bar");', 'const x = require("./foo\n¦bar");');
        enter('const x = await import("./foo¦bar");', 'const x = await import("./foo\n¦bar");');
        enter('require_once "foo¦bar.php";', 'require_once "foo\n¦bar.php";', { language: 'php' });
        enter('import (\n    "foo¦bar"\n)', 'import (\n    "foo\n    ¦bar"\n)', { language: 'go' });
    });

    it('still splits the string of a call that merely mentions a module name', () => {
        enter('const a = Array.from("foo¦bar");', 'const a = Array.from("foo" +\n    "¦bar");');
        enter('const important = "foo¦bar";', 'const important = "foo" +\n    "¦bar";');
    });
});

describe('Enter after an opener', () => {
    it.each([
        ['{¦}', '{\n    ¦\n}'],
        ['  {¦}', '  {\n      ¦\n  }'],
        ['f(¦)', 'f(\n    ¦\n)'],
        ['[¦]', '[\n    ¦\n]'],
        ['if (x) {¦\n}', 'if (x) {\n    ¦\n}'],
        ['foo(¦   bar)', 'foo(\n    ¦bar)'],
        ['a;¦   b;', 'a;\n¦b;']
    ])('indents %s', (source, expected) => enter(source, expected));

    it('closes a brace nothing closes', () => {
        enter('if (x) {¦', 'if (x) {\n    ¦\n}');
        enter('    if (x) {¦', '    if (x) {\n        ¦\n    }');
        enter('if (x) {¦foo();', 'if (x) {\n    ¦foo();\n}');
        enter('foo({¦)', 'foo({\n    ¦\n})');
        enter('function a() {\n    if (x) {¦', 'function a() {\n    if (x) {\n        ¦\n    }');
        enter('function a() {\n    if (x) {¦\n}', 'function a() {\n    if (x) {\n        ¦\n}');
    });

    it('does not add a closer when the brace has one, or for another bracket', () => {
        enter('if (x) {¦\n    foo();\n}', 'if (x) {\n    ¦\n    foo();\n}');
        enter('foo(¦', 'foo(\n    ¦');
    });

    it('does not close a brace in a string or a comment', () => {
        enter('// {¦', '// {\n¦');
        enter('const a = "{¦";', 'const a = "{" +\n    "¦";');
    });

    it('uses tabs', () => {
        enter('\tif (x) {¦', '\tif (x) {\n\t\t¦\n\t}', { insertSpaces: false });
    });
});

describe('Enter indenting by language', () => {
    it('indents after a Python colon', () => {
        enter('def f():¦', 'def f():\n    ¦', { language: 'python' });
        enter('    if x:¦', '    if x:\n        ¦', { language: 'python' });
        enter('x = {"a":¦}', 'x = {"a":\n¦}', { language: 'python' });
        enter('x = 1  # note:¦', 'x = 1  # note:\n¦', { language: 'python' });
    });

    it('indents after a YAML key and under a list item', () => {
        enter('key:¦', 'key:\n  ¦', { language: 'yaml', tabSize: 2 });
        enter('a:\n  b:¦', 'a:\n  b:\n    ¦', { language: 'yaml', tabSize: 2 });
        enter('- name:¦', '- name:\n    ¦', { language: 'yaml', tabSize: 2 });
        enter('text: |¦', 'text: |\n  ¦', { language: 'yaml', tabSize: 2 });
        enter('key: value¦', 'key: value\n¦', { language: 'yaml', tabSize: 2 });
        enter('# note:¦', '# note:\n¦', { language: 'yaml', tabSize: 2 });
    });

    it('indents after a case label', () => {
        enter('switch (x) {\n    case 1:¦\n}', 'switch (x) {\n    case 1:\n        ¦\n}');
        enter('switch (x) {\n    default:¦\n}', 'switch (x) {\n    default:\n        ¦\n}');
    });

    it('indents between and after tags', () => {
        enter('<div>¦</div>', '<div>\n    ¦\n</div>', { language: 'html' });
        enter('    <ul class="list">¦</ul>', '    <ul class="list">\n        ¦\n    </ul>', { language: 'html' });
        enter('<div>¦', '<div>\n    ¦', { language: 'html' });
        enter('<br>¦', '<br>\n¦', { language: 'html' });
        enter('<img src="a.png" />¦', '<img src="a.png" />\n¦', { language: 'html' });
        enter('</div>¦', '</div>\n¦', { language: 'html' });
        enter('<Foo onClick={() => go()}>¦', '<Foo onClick={() => go()}>\n    ¦', { language: 'tsx' });
        enter('const a: Array<string>¦', 'const a: Array<string>\n¦', { language: 'tsx' });
        enter('<template>¦', '<template>\n    ¦', { language: 'vue' });
        enter('<script>\nconst a: Array<string>¦', '<script>\nconst a: Array<string>\n¦', { language: 'vue' });
    });
});

describe('Enter continuing a statement', () => {
    it.each([
        ['if (x)¦', 'if (x)\n    ¦'],
        ['    while (x)¦', '    while (x)\n        ¦'],
        ['else¦', 'else\n    ¦'],
        ['} else¦', '} else\n    ¦'],
        ['const a =¦', 'const a =\n    ¦'],
        ['const f = () =>¦', 'const f = () =>\n    ¦'],
        ['const a = b +¦', 'const a = b +\n    ¦'],
        ['const a = b &&¦', 'const a = b &&\n    ¦'],
        ['const a = b ??¦', 'const a = b ??\n    ¦'],
        ['const a = b ?¦', 'const a = b ?\n    ¦'],
        ['i++¦', 'i++\n¦'],
        ['foo(a,¦', 'foo(a,\n¦'],
        ['foo()¦', 'foo()\n¦']
    ])('continues %s', (source, expected) => enter(source, expected));

    it('goes back to the statement once the continuation ends', () => {
        enter('if (x)\n    foo();¦', 'if (x)\n    foo();\n¦');
        enter('    if (x)\n        foo();¦', '    if (x)\n        foo();\n    ¦');
        enter('const a = 1 +\n    2;¦', 'const a = 1 +\n    2;\n¦');
        enter('const a = 1 +\n    2 +¦', 'const a = 1 +\n    2 +\n    ¦');
        enter('if (x)\n    if (y)\n        foo();¦', 'if (x)\n    if (y)\n        foo();\n¦');
    });

    it('does not continue in a comment or in a language without braces', () => {
        enter('a = 1; // x =¦', 'a = 1; // x =\n¦');
        enter('x = 1 +¦', 'x = 1 +\n¦', { language: 'python' });
        enter('a = [1,¦', 'a = [1,\n¦');
    });

    it('continues a PHP concatenation', () => {
        enter('$a = $b .¦', '$a = $b .\n    ¦', { language: 'php' });
    });
});

describe('Enter in general', () => {
    it('breaks plainly without smart indentation', () => {
        enter('    if (x) {¦', '    if (x) {\n    ¦', { smartEnter: false });
        enter('// foo¦bar', '// foo\n¦bar', { smartEnter: false });
    });

    it('replaces a selection and every caret', () => {
        const model = new DocumentModel('a(b)\nc(d)');
        model.setSelections([
            { anchor: 2, head: 2 },
            { anchor: 7, head: 7 }
        ]);
        model.execute('insertNewline', { language: 'typescript' });
        expect(model.getText()).toBe('a(\n    b)\nc(\n    d)');
        const selected = new DocumentModel('foo(bar)');
        selected.setSelections([{ anchor: 4, head: 7 }]);
        selected.execute('insertNewline', { language: 'typescript' });
        expect(selected.getText()).toBe('foo(\n    \n)');
    });

    it('does not let two carets on one line overlap their edits', () => {
        const model = new DocumentModel('{ a, b');
        model.setSelections([
            { anchor: 1, head: 1 },
            { anchor: 4, head: 4 }
        ]);
        model.execute('insertNewline', { language: 'typescript' });
        expect(model.getText()).toBe('{\n    a,\nb');
    });

    it('keeps CRLF', () => {
        const model = new DocumentModel('if (x) {\r\n}');
        model.setSelections([{ anchor: 8, head: 8 }]);
        model.execute('insertNewline', { language: 'typescript' });
        expect(model.getText()).toBe('if (x) {\r\n    \r\n}');
    });
});
