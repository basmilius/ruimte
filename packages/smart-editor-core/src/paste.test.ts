import { describe, expect, it } from 'bun:test';
import { DocumentModel } from './document.ts';
import type { CommandOptions } from './types.ts';

function parse(source: string): { text: string; carets: number[] } {
    const carets: number[] = [];
    let text = '';
    for (const character of source) {
        if (character === '¦') {
            carets.push(text.length);
        } else {
            text += character;
        }
    }
    return { text, carets };
}

function paste(source: string, pasted: string, expected: string, options: CommandOptions & { wholeLines?: boolean } = {}): void {
    const initial = parse(source);
    const model = new DocumentModel(initial.text);
    model.setSelections(initial.carets.map((caret) => ({ anchor: caret, head: caret })));
    model.paste(pasted, { language: 'typescript', ...options });
    const heads = model.getSelections().map((selection) => selection.head);
    let result = model.getText();
    for (const head of [...heads].sort((left, right) => right - left)) {
        result = result.slice(0, head) + '¦' + result.slice(head);
    }
    expect(result).toBe(expected);
}

describe('paste of lines copied from a bare caret', () => {
    it('goes above the line of the caret, which stays on its text', () => {
        paste('one\ntw¦o', 'copied\n', 'one\ncopied\ntw¦o', { wholeLines: true });
        paste('one\n¦two', 'copied\n', 'one\ncopied\n¦two', { wholeLines: true });
        paste('one¦', 'copied', 'copied\none¦', { wholeLines: true });
    });

    it('takes a line for each caret when the counts match, and every line otherwise', () => {
        paste('a\nb¦\nc¦', 'x\ny\n', 'a\nx\nb¦\ny\nc¦', { wholeLines: true });
        paste('a¦\nb¦', 'x\ny\nz\n', 'x\ny\nz\na¦\nx\ny\nz\nb¦', { wholeLines: true });
    });

    it('stacks the pieces of carets on one line', () => {
        paste('a¦b¦', 'x\ny\n', 'x\ny\na¦b¦', { wholeLines: true });
    });

    it('is an ordinary paste with a selection or without the mark', () => {
        const model = new DocumentModel('one two');
        model.setSelections([{ anchor: 0, head: 3 }]);
        model.paste('X\n', { language: 'typescript', wholeLines: true });
        expect(model.getText()).toBe('X\n two');
        paste('one¦ two', 'X\n', 'oneX\n¦ two');
    });
});

describe('paste with several carets', () => {
    it('gives each caret one line when there are as many lines as carets', () => {
        paste('a¦ b¦', 'x\ny', 'ax¦ by¦');
        paste('a¦\nb¦\nc¦', 'x\ny\nz\n', 'ax¦\nby¦\ncz¦');
    });

    it('gives each caret all of the text otherwise', () => {
        paste('a¦ b¦', 'x\ny\nz', 'ax\ny\nz¦ bx\ny\nz¦');
    });
});

describe('paste indentation', () => {
    it('moves a block that starts at the caret to the indentation of its line', () => {
        paste('    ¦', 'foo();\nbar();', '    foo();\n    bar();¦');
        paste('function f() {\n    ¦\n}', 'if (x) {\n    y;\n}', 'function f() {\n    if (x) {\n        y;\n    }¦\n}');
    });

    it('moves a block copied with its own indentation', () => {
        paste('function f() {\n    ¦\n}', '        a();\n        b();\n', 'function f() {\n    a();\n    b();\n    ¦\n}');
        paste('¦', '        a();\n    b();\n', '    a();\nb();\n¦');
        paste('function f() {\n¦\n}', '        a();\n          b();', 'function f() {\na();\n  b();¦\n}');
    });

    it('indents the lines under a first line that is not at the start of its line', () => {
        paste('    const a = ¦', '{\n    x: 1\n}', '    const a = {\n        x: 1\n    }¦');
        paste('    log(¦)', 'a,\nb', '    log(a,\n    b¦)');
    });

    it('keeps what follows the paste under the indentation of the line', () => {
        paste('    ¦foo()', 'a\nb\n', '    a\n    b\n    ¦foo()');
        paste('  const x = ¦y', 'a\nb\n', '  const x = a\n  b\n  ¦y');
    });

    it('leaves one line, blank lines and the setting alone', () => {
        paste('    ¦', 'foo', '    foo¦');
        paste('    ¦', 'a\n\nb', '    a\n\n    b¦');
        paste('    ¦', 'a\nb', '    a\nb¦', { indentOnPaste: false });
    });

    it('never takes more than a line has', () => {
        paste('  ¦', '        a\n  b', '        a\n  b¦');
        paste('  ¦', '  a\n          b', '  a\n          b¦'.replace('          b', '          b'));
    });

    it('uses tabs when the document does', () => {
        paste('\t¦', 'a\nb', '\ta\n\tb¦', { insertSpaces: false });
    });

    it('treats every caret on its own', () => {
        paste('f(\n    ¦\n)\ng(\n¦\n)', 'a\nb\nc', 'f(\n    a\n    b\n    c¦\n)\ng(\na\nb\nc¦\n)');
    });
});

describe('paste that lands outside code', () => {
    const block = 'if (x) {\n    run();\n}';

    it('keeps the lines as copied inside a template literal, a string, a block comment and a line comment', () => {
        paste('function f() {\n    const a = `¦`;\n}', block, 'function f() {\n    const a = `' + block + '¦`;\n}');
        paste('function f() {\n    /*\n     * ¦\n     */\n}', block, 'function f() {\n    /*\n     * ' + block + '¦\n     */\n}');
        paste('function f() {\n    // note ¦\n}', block, 'function f() {\n    // note ' + block + '¦\n}');
        paste("function f() {\n    const a = 'x¦';\n}", block, "function f() {\n    const a = 'x" + block + "¦';\n}");
    });

    it('keeps the lines as copied in a heredoc and in the markup of a PHP file', () => {
        paste('<?php\nfunction f() {\n    $a = <<<EOT\n  ¦\nEOT;\n}', block, '<?php\nfunction f() {\n    $a = <<<EOT\n  ' + block + '¦\nEOT;\n}', {
            language: 'php'
        });
        paste('<?php ?>\n<div>¦</div>', block, '<?php ?>\n<div>' + block + '¦</div>', { language: 'php' });
    });

    it('still moves a block to the indentation of the code it lands in', () => {
        paste('function f() {\n    ¦\n}', block, 'function f() {\n    ' + block.replace(/\n/g, '\n    ') + '¦\n}');
    });
});
