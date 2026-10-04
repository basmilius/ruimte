import { describe, expect, it } from 'bun:test';
import { DocumentModel, type TypeTextOptions } from './document.ts';

function marked(text: string): { text: string; offset: number } {
    const offset = text.indexOf('¦');
    if (offset < 0) {
        throw new Error('Caret marker is missing.');
    }
    return { text: text.replace('¦', ''), offset };
}
function at(text: string): DocumentModel {
    const initial = marked(text);
    const model = new DocumentModel(initial.text);
    model.setSelections([{ anchor: initial.offset, head: initial.offset }]);
    return model;
}
function expectMarked(model: DocumentModel, text: string): void {
    const expected = marked(text);
    expect(model.getText()).toBe(expected.text);
    expect(model.getSelections()).toEqual([{ anchor: expected.offset, head: expected.offset }]);
}
function type(source: string, character: string, expected: string, options: TypeTextOptions = {}): void {
    const model = at(source);
    model.typeText(character, options);
    expectMarked(model, expected);
}

describe('lexical pairing contexts', () => {
    it.each([
        ['call(1¦)', ')', 'call(1)¦'],
        ['const 𝒜¦', "'", "const 𝒜'¦"],
        ['const e\u0301¦', "'", "const e\u0301'¦"],
        ['values[0¦]', ']', 'values[0]¦'],
        ['{ value: 1¦}', '}', '{ value: 1}¦'],
        ['¦)', ')', ')¦)'],
        ['call(1¦]', ']', 'call(1]¦]'],
        ['const text = "value¦";', '"', 'const text = "value"¦;'],
        ['const text = "value\\¦";', '"', 'const text = "value\\"¦";'],
        ['// comment ¦)', ')', '// comment )¦)'],
        ['/* comment\n¦ */', '(', '/* comment\n(¦ */'],
        ['const text = "¦";', '(', 'const text = "(¦";'],
        ['const re = /[¦]/;', '(', 'const re = /[(¦]/;'],
        ['const re = /\\[¦/;', '[', 'const re = /\\[[¦/;'],
        ['const message = `text ¦`;', '(', 'const message = `text (¦`;'],
        ['const message = `text $¦`;', '{', 'const message = `text ${¦}`;'],
        ['const message = `text \\$¦`;', '{', 'const message = `text \\${¦`;'],
        ['const message = `${call(1¦)}`;', ')', 'const message = `${call(1)¦}`;'],
        ['const message = `${{ value: 1¦}}`;', '}', 'const message = `${{ value: 1}¦}`;'],
        ['const message = `${value}¦`;', '`', 'const message = `${value}`¦;']
    ])('types %s as %s with its actual context', (source, character, expected) => type(source, character, expected));

    it.each([
        ['javascript', 'const ratio = (count++ / 2¦);', ')', 'const ratio = (count++ / 2)¦;'],
        ['javascript', 'const ratio = (++count / 2¦);', ')', 'const ratio = (++count / 2)¦;'],
        ['typescript', 'const ratio = ({ value: 1 } / 2¦);', ')', 'const ratio = ({ value: 1 } / 2)¦;'],
        ['javascript', 'const ratio = (object.value / 2¦);', ')', 'const ratio = (object.value / 2)¦;'],
        ['typescript', 'const ratio = (count-- / 2¦);', ')', 'const ratio = (count-- / 2)¦;'],
        ['javascript', 'function f() {}\n/[¦]/.test(value);', '(', 'function f() {}\n/[(¦]/.test(value);'],
        ['typescript', 'if (ready) {}\n/[¦]/.test(value);', '(', 'if (ready) {}\n/[(¦]/.test(value);'],
        ['php', '<?php\n$text = "first\n¦";', '(', '<?php\n$text = "first\n(¦";'],
        ['php', '<?php\n# comment ¦', '[', '<?php\n# comment [¦'],
        ['php', '<?php\n#[Attribute(1¦)]', ')', '<?php\n#[Attribute(1)¦]'],
        ['json', '{ "text": "¦" }', '[', '{ "text": "[¦" }'],
        ['json', '{ "value": ¦ }', '[', '{ "value": [¦] }']
    ])('respects %s grammar at %s', (language, source, character, expected) => type(source, character, expected, { language }));

    it('chooses independently for code, a comment and a string at multiple carets', () => {
        const model = new DocumentModel('value = \n// comment \n"text "');
        model.setSelections([
            { anchor: 8, head: 8 },
            { anchor: 20, head: 20 },
            { anchor: 27, head: 27 }
        ]);
        model.typeText('(', { language: 'typescript' });
        expect(model.getText()).toBe('value = ()\n// comment (\n"text ("');
        expect(model.getSelections()).toEqual([
            { anchor: 9, head: 9 },
            { anchor: 23, head: 23 },
            { anchor: 31, head: 31 }
        ]);
        model.undo();
        expect(model.getText()).toBe('value = \n// comment \n"text "');
        model.redo();
        expect(model.getText()).toBe('value = ()\n// comment (\n"text ("');
    });

    it('invalidates cached multiline state after external edits, undo and redo', () => {
        const model = at('/* start\n¦\n*/');
        model.typeText('(', { language: 'typescript' });
        expectMarked(model, '/* start\n(¦\n*/');
        model.undo();
        model.applyEdits([{ from: 0, to: 2, text: '//' }], { source: 'external' });
        model.setSelections([{ anchor: 9, head: 9 }]);
        model.typeText('[', { language: 'typescript' });
        expectMarked(model, '// start\n[¦]\n*/');
        model.undo();
        model.undo();
        expect(model.getText()).toBe('/* start\n\n*/');
        model.setSelections([{ anchor: 9, head: 9 }]);
        model.typeText('{', { language: 'typescript' });
        expectMarked(model, '/* start\n{¦\n*/');
        model.undo();
        model.redo();
        expectMarked(model, '/* start\n{¦\n*/');
    });

    it('keeps quote and comment punctuation literal in Enter and Backspace', () => {
        const comment = at('// {¦}');
        comment.execute('insertNewline', { language: 'typescript' });
        expectMarked(comment, '// {\n// ¦}');
        const quoted = at('const text = "(¦)";');
        quoted.execute('smartBackspace', { language: 'typescript' });
        expectMarked(quoted, 'const text = "¦)";');
        const block = at('/*\n(¦)\n*/');
        block.execute('smartBackspace', { language: 'typescript' });
        expectMarked(block, '/*\n¦)\n*/');
    });

    it('reads a closer as code once a typed quote ends the string it was inside', () => {
        const model = at("console.log('Hallo wereld!¦)");
        model.typeText("'", { language: 'typescript' });
        expectMarked(model, "console.log('Hallo wereld!'¦)");
        model.typeText(')', { language: 'typescript' });
        expectMarked(model, "console.log('Hallo wereld!')¦");
    });

    it('honors disabled pairing and preserves text history across a pure closer skip', () => {
        type('call(1¦)', ')', 'call(1)¦)', { autoClosingPairs: false });
        const model = at('¦');
        model.typeText('(');
        model.typeText('x');
        const revision = model.getRevision();
        model.typeText(')');
        expectMarked(model, '(x)¦');
        expect(model.getRevision()).toBe(revision);
        model.undo();
        expect(model.getText()).toBe('');
        model.redo();
        expectMarked(model, '(x¦)');
    });
});

describe('smart semicolon boundaries', () => {
    it.each([
        ['typescript', 'const value = call(1¦)', 'const value = call(1);¦'],
        ['javascript', 'call(inner(1¦));', 'call(inner(1));¦'],
        ['php', '<?php\n$value = call(1¦)', '<?php\n$value = call(1);¦'],
        ['typescript', 'call(1¦) // explanation', 'call(1);¦ // explanation'],
        ['typescript', 'call(1¦)  ', 'call(1);¦  '],
        ['typescript', 'call(1¦)  ;', 'call(1)  ;¦'],
        ['typescript', 'for await (const value of call(1¦))', 'for await (const value of call(1;¦))'],
        ['typescript', 'call(1¦) + next()', 'call(1;¦) + next()'],
        ['typescript', 'call(inner(1¦), next())', 'call(inner(1;¦), next())'],
        ['typescript', 'call(¦)', 'call(;¦)'],
        ['typescript', 'for (let i = 0¦; i < 10; i++) {}', 'for (let i = 0;¦; i < 10; i++) {}'],
        ['typescript', 'for (const value of call(1¦)) {}', 'for (const value of call(1;¦)) {}'],
        ['typescript', '// call(1¦)', '// call(1;¦)'],
        ['typescript', 'const text = "call(1¦)";', 'const text = "call(1;¦)";'],
        ['typescript', 'const text = `call(1¦)`;', 'const text = `call(1;¦)`;'],
        ['json', '{ "value": [1¦] }', '{ "value": [1;¦] }']
    ])('handles %s terminator in %s', (language, source, expected) => type(source, ';', expected, { language }));

    it('deduplicates shared semicolon targets without shifting later carets twice', () => {
        const model = new DocumentModel('foo(inner(1))\nbar(2) // note');
        model.setSelections([
            { anchor: 11, head: 11 },
            { anchor: 12, head: 12 },
            { anchor: 19, head: 19 }
        ]);
        model.typeText(';', { language: 'typescript' });
        expect(model.getText()).toBe('foo(inner(1));\nbar(2); // note');
        expect(model.getSelections()).toEqual([
            { anchor: 14, head: 14 },
            { anchor: 22, head: 22 }
        ]);
    });

    it('keeps per-caret crossed-closer markers attached after shared targets merge', () => {
        const model = new DocumentModel('foo(inner(1))\nvalues[2] // note');
        model.setSelections([
            { anchor: 11, head: 11 },
            { anchor: 12, head: 12 },
            { anchor: 22, head: 22 }
        ]);
        model.typeText(';', { language: 'typescript' });
        expect(model.getText()).toBe('foo(inner(1));\nvalues[2]; // note');
        model.typeText(')', { language: 'typescript' });
        expect(model.getText()).toBe('foo(inner(1));\nvalues[2];) // note');
    });

    it('consumes only the closers just crossed by smart semicolon', () => {
        const model = at('outer(inner(1¦))');
        model.typeText(';', { language: 'typescript' });
        expectMarked(model, 'outer(inner(1));¦');
        const revision = model.getRevision();
        model.typeText(')', { language: 'typescript' });
        model.typeText(')', { language: 'typescript' });
        expectMarked(model, 'outer(inner(1));¦');
        expect(model.getRevision()).toBe(revision);
        model.typeText(')', { language: 'typescript' });
        expectMarked(model, 'outer(inner(1));)¦');
    });

    it('does not retain crossed-closer grace after an external document edit', () => {
        const model = at('call(1¦)');
        model.typeText(';', { language: 'typescript' });
        model.applyEdits([{ from: 0, to: 4, text: 'next' }], { source: 'external' });
        model.typeText(')', { language: 'typescript' });
        expectMarked(model, 'next(1);)¦');
    });

    it('can disable smart semicolon separately from pairing', () => {
        type('call(1¦)', ';', 'call(1;¦)', { language: 'typescript', smartSemicolon: false });
        type('call(1¦)', ';', 'call(1);¦', { language: 'typescript', autoClosingPairs: false });
    });
});
