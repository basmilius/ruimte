import { describe, expect, it } from 'bun:test';
import { DocumentModel } from './document.ts';
import { jsxRanges } from './markup-regions.ts';
import { TypingContexts } from './typing-context.ts';

function autoIndent(text: string, language: string): string {
    const model = new DocumentModel(text);
    model.execute('selectAll');
    model.execute('autoIndentLines', { language });
    return model.getText();
}

describe('Auto-indent Lines leaves markup and literals alone', () => {
    it('keeps the JSX of a component as written and still fixes the code around it', () => {
        const source = [
            'function App() {',
            'const items = [1, 2];',
            'return (',
            '<div className="app">',
            '      {items.map((item) => (',
            "  <span key={item}>it's {item}</span>",
            '      ))}',
            '</div>',
            ');',
            '}'
        ].join('\n');
        expect(autoIndent(source, 'tsx')).toBe(
            [
                'function App() {',
                '    const items = [1, 2];',
                '    return (',
                '<div className="app">',
                '      {items.map((item) => (',
                "  <span key={item}>it's {item}</span>",
                '      ))}',
                '</div>',
                '    );',
                '}'
            ].join('\n')
        );
    });

    it('keeps JSX that stands in an expression, a fragment and a self-closing element', () => {
        const source = ['const a = cond ? <A x={1} /> : <>', 'text', '</>;', 'const b = 1;'].join('\n');
        expect(autoIndent(source, 'jsx')).toBe(source);
    });

    it('reads a generic and a comparison as code and not as an element', () => {
        expect(jsxRanges('const a = useState<string>(x);\nif (a <b && c> d) {}\n')).toEqual([]);
        expect(jsxRanges('const a = <div>{"</div>"}</div>;')).toEqual([{ from: 10, to: 31 }]);
    });

    it('leaves a Vue template alone and indents its script and style', () => {
        const source = [
            '<template>',
            '<div>',
            '  <p>{{ msg }}</p>',
            '</div>',
            '</template>',
            '<script setup lang="ts">',
            'if (x) {',
            'run();',
            '}',
            '</script>',
            '<style>',
            '.a {',
            'color: red;',
            '}',
            '</style>'
        ].join('\n');
        expect(autoIndent(source, 'vue')).toBe(
            [
                '<template>',
                '<div>',
                '  <p>{{ msg }}</p>',
                '</div>',
                '</template>',
                '<script setup lang="ts">',
                'if (x) {',
                '    run();',
                '}',
                '</script>',
                '<style>',
                '.a {',
                '    color: red;',
                '}',
                '</style>'
            ].join('\n')
        );
    });

    it('leaves the HTML of a PHP file and its heredocs alone', () => {
        const source = [
            '<?php',
            'function f() {',
            '$x = <<<EOT',
            '   body {',
            '  $y',
            '       EOT;',
            'if ($x) {',
            'return 1;',
            '}',
            '}',
            '?>',
            '<div>',
            "      <p>it's</p>",
            '</div>',
            '<?php if ($a) { ?>',
            '   <b>x</b>',
            '<?php } ?>'
        ].join('\n');
        expect(autoIndent(source, 'php')).toBe(
            [
                '<?php',
                'function f() {',
                '    $x = <<<EOT',
                '   body {',
                '  $y',
                '       EOT;',
                '    if ($x) {',
                '        return 1;',
                '    }',
                '}',
                '?>',
                '<div>',
                "      <p>it's</p>",
                '</div>',
                '<?php if ($a) { ?>',
                '   <b>x</b>',
                '<?php } ?>'
            ].join('\n')
        );
    });

    it('leaves a template literal and a multi-line string alone', () => {
        const source = ['function f() {', 'const s = `a', '   b ${c}', '  d`;', 'return s;', '}'].join('\n');
        expect(autoIndent(source, 'typescript')).toBe(['function f() {', '    const s = `a', '   b ${c}', '  d`;', '    return s;', '}'].join('\n'));
    });
});

function modeAtLineStart(model: DocumentModel, line: number, language: string): string {
    return new TypingContexts((index) => model.getLine(index)).at(line, 0, language).mode;
}

describe('PHP lexing around its tags', () => {
    it('reads the markup of a file and a heredoc body as neither code nor strings', () => {
        const model = new DocumentModel(["<p>it's</p>", '<?php', '$a = <<<EOT', "it's {", 'EOT;', '$b = [1];', '?>', '<b>"', '<?= $c ?>'].join('\n'));
        const modes = Array.from({ length: 9 }, (_, line) => modeAtLineStart(model, line, 'php'));
        expect(modes).toEqual(['html', 'html', 'code', 'heredoc', 'heredoc', 'code', 'code', 'html', 'html']);
    });

    it('ends a line comment at a closing tag', () => {
        const model = new DocumentModel('<?php // note ?>\n<i>');
        expect(modeAtLineStart(model, 1, 'php')).toBe('html');
    });
});
