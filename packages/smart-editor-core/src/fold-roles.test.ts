import { describe, expect, it } from 'bun:test';
import { DocumentModel } from './document.ts';
import type { FoldHints } from './structure.ts';

function roles(text: string, language: string, hints?: FoldHints) {
    return new DocumentModel(text)
        .getFoldingRanges({ language, indentation: language === 'python', ...(hints === undefined ? {} : { hints }) })
        .map((range) => [range.startLine, range.endLine, range.role ?? null]);
}

describe('doc comments and the file header', () => {
    it('reads a comment of two stars as documentation', () => {
        expect(roles('class A {\n    /**\n     * Doc.\n     */\n    run() {}\n    /*\n     * Plain.\n     */\n}', 'typescript')).toEqual([
            [0, 8, null],
            [1, 3, 'doc-comment'],
            [5, 7, null]
        ]);
    });

    it('takes the first comment of a file as its header, behind a shebang or an open tag', () => {
        expect(roles('/*\n * License.\n */\n\nconst a = 1;', 'typescript')).toEqual([[0, 2, 'file-header']]);
        expect(roles('#!/usr/bin/env bun\n// one\n// two\nconst a = 1;', 'typescript')).toEqual([[1, 2, 'file-header']]);
        expect(roles('<?php\n\n/**\n * File.\n */\n\nnamespace A;', 'php')).toEqual([[2, 4, 'file-header']]);
    });

    it('keeps the documentation of what follows right under it a doc comment', () => {
        expect(roles('/**\n * The class.\n */\nexport class A {\n}', 'typescript')).toEqual([
            [0, 2, 'doc-comment'],
            [3, 4, null]
        ]);
    });

    it('still reads a docblock above the imports as the header', () => {
        expect(roles("/**\n * @license MIT\n */\nimport a from 'a';\nimport b from 'b';", 'typescript')).toEqual([
            [0, 2, 'file-header'],
            [3, 4, 'imports']
        ]);
    });

    it('leaves a comment that is not at the top alone', () => {
        expect(roles('const a = 1;\n/*\n * Later.\n */\nconst b = 2;', 'typescript')).toEqual([[1, 3, null]]);
    });

    it('marks imports and regions', () => {
        expect(roles("import a from 'a';\nimport b from 'b';\n// region x\nlet a;\n// endregion", 'typescript')).toEqual([
            [0, 1, 'imports'],
            [2, 4, 'region']
        ]);
    });
});

describe('literals', () => {
    it('reads an object after an equals sign, a colon, an open parenthesis or return, and an array the same', () => {
        const text =
            'const a = {\n    b: [\n        1,\n    ],\n    c: {\n        d: 1,\n    },\n};\nrun({\n    e: 1,\n});\nfunction f() {\n    return [\n        1,\n    ];\n}';
        expect(roles(text, 'typescript')).toEqual([
            [0, 7, 'object-literal'],
            [1, 3, 'array-literal'],
            [4, 6, 'object-literal'],
            [8, 10, 'object-literal'],
            [11, 15, null],
            [12, 14, 'array-literal']
        ]);
    });

    it('does not read a block, a class body, an index or a destructuring pattern as a value', () => {
        const text = 'if (a) {\n    b();\n} else {\n    c();\n}\nclass A {\n    x = 1;\n}\nconst [\n    d,\n    e,\n] = f;\nitems[\n    0\n];';
        expect(roles(text, 'typescript').filter((range) => range[2] !== null)).toEqual([]);
    });

    it('does not read a case block or a type alias as a value', () => {
        expect(roles('switch (a) {\n    case 1: {\n        b();\n    }\n}\ntype T = {\n    c: 1;\n};', 'typescript').map((range) => range[2])).toEqual([
            null,
            null,
            null
        ]);
    });

    it('reads an array after an arrow, and not a block after one', () => {
        expect(roles('const f = () => [\n    1,\n];\nconst g = () => {\n    h();\n};', 'typescript')).toEqual([
            [0, 2, 'array-literal'],
            [3, 5, null]
        ]);
    });

    it('is for scripts only, and reads a PHP attribute list', () => {
        expect(roles('$a = [\n    1,\n];', 'php')).toEqual([[0, 2, null]]);
        expect(roles('#[Route(\n    path: "/",\n)]\nclass A\n{\n}', 'php').map((range) => range[2])).toEqual(['attribute', null]);
        expect(roles('#[\n    Route("/"),\n    Cache(),\n]\nclass A\n{\n}', 'php')[0]).toEqual([0, 3, 'attribute']);
    });
});

describe('hints of a language server', () => {
    const text =
        'class A {\n    run(\n        x: number,\n    ) {\n        return 1;\n    }\n}\nfunction f() {\n    g();\n}\nconst h = () => {\n    i();\n};\nconst o = 3;';
    const offsetOf = (line: number, column: number): number => new DocumentModel(text).offsetAt({ line, column });

    it('names the body a symbol has, between the brackets', () => {
        const hints: FoldHints = {
            symbols: [
                { from: offsetOf(0, 0), to: offsetOf(6, 1), body: 'class' },
                { from: offsetOf(1, 4), to: offsetOf(5, 5), body: 'method' },
                { from: offsetOf(7, 0), to: offsetOf(9, 1), body: 'function' },
                { from: offsetOf(10, 0), to: offsetOf(12, 2), body: 'value' },
                { from: offsetOf(13, 0), to: offsetOf(13, 12), body: 'value' }
            ]
        };
        expect(roles(text, 'typescript', hints)).toEqual([
            [0, 6, 'class-body'],
            [1, 3, null],
            [3, 5, 'method-body'],
            [7, 9, 'function-body'],
            [10, 12, 'function-body']
        ]);
    });

    it('names an indented body, as in Python', () => {
        const python = 'def f():\n    a = 1\n    return a\n\nx = 2';
        const model = new DocumentModel(python);
        const hints: FoldHints = { symbols: [{ from: 0, to: model.offsetAt({ line: 2, column: 12 }), body: 'function' }] };
        expect(roles(python, 'python', hints)).toEqual([[0, 2, 'function-body']]);
    });

    it('adds the ranges the text has no fold for, one per line they start on', () => {
        const html = '<ul>\n    <li>a</li>\n</ul>\n<div>\n    <p>\n        b\n    </p>\n</div>';
        const model = new DocumentModel(html);
        const hints: FoldHints = {
            ranges: [
                { from: model.offsetAt({ line: 0, column: 0 }), to: model.offsetAt({ line: 1, column: 0 }) },
                { from: model.offsetAt({ line: 3, column: 0 }), to: model.offsetAt({ line: 6, column: 0 }) },
                { from: model.offsetAt({ line: 4, column: 0 }), to: model.offsetAt({ line: 5, column: 0 }) }
            ]
        };
        expect(roles(html, 'html', hints)).toEqual([
            [0, 1, 'tag'],
            [3, 6, 'tag'],
            [4, 5, 'tag']
        ]);
    });

    it('leaves a range alone whose first line already starts a fold', () => {
        const source = 'function f() {\n    a();\n    b();\n}';
        const model = new DocumentModel(source);
        const hints: FoldHints = { ranges: [{ from: 0, to: model.offsetAt({ line: 2, column: 0 }) }] };
        expect(roles(source, 'typescript', hints)).toEqual([[0, 3, null]]);
    });

    it('reads the kinds a server gives a range', () => {
        const source = "import a from 'a';\nimport b from 'b';\n\n/**\n * Doc.\n */\n// region\nx;\n// endregion";
        const model = new DocumentModel(source);
        const hints: FoldHints = {
            ranges: [
                { from: 0, to: model.offsetAt({ line: 1, column: 0 }), kind: 'imports' },
                { from: model.offsetAt({ line: 3, column: 0 }), to: model.offsetAt({ line: 5, column: 0 }), kind: 'comment' }
            ]
        };
        expect(roles(source, 'python', hints)).toEqual([
            [0, 1, 'imports'],
            [3, 5, 'doc-comment'],
            [6, 8, 'region']
        ]);
    });
});
