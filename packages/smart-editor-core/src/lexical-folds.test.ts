import { describe, expect, it } from 'bun:test';
import { DocumentModel } from './document.ts';

function folds(text: string, language: string) {
    return new DocumentModel(text).getFoldingRanges({ language }).map((range) => [range.kind, range.startLine, range.endLine]);
}

describe('import folds', () => {
    it('folds a run of imports, blank lines between them included, and not what comes after', () => {
        const text = "import a from 'a';\nimport b from 'b';\n\nimport c from 'c';\n\nconst x = 1;\nimport('d');";
        expect(folds(text, 'typescript')).toEqual([['imports', 0, 3]]);
    });

    it('takes a multi-line import as one statement and leaves one import alone', () => {
        const text = "import {\n    a,\n    b\n} from 'x';\nconst y = 2;";
        expect(folds(text, 'typescript')).toEqual([['imports', 0, 3]]);
        const two = "import {\n    a\n} from 'x';\nimport b from 'b';\nlet z;";
        expect(folds(two, 'typescript')[0]).toEqual(['imports', 0, 3]);
    });

    it('reads the words of each language', () => {
        expect(folds('use App\\A;\nuse App\\B;\n\nclass C {}', 'php')).toEqual([['imports', 0, 1]]);
        expect(folds('import os\nfrom . import x\nfrom a import (\n    b,\n)\n\nx = 1', 'python')).toEqual([
            ['imports', 0, 4],
            ['bracket', 2, 4]
        ]);
        expect(folds('use std::io;\nuse std::fs;\nfn main() {}', 'rust')).toEqual([['imports', 0, 1]]);
    });

    it('does not read prose or SQL as imports', () => {
        expect(folds('from now on\nuse the force\n', 'markdown')).toEqual([]);
        expect(folds('select 1\nfrom t\nuse x', 'sql')).toEqual([]);
    });

    it('leaves a dynamic import and import.meta out', () => {
        expect(folds("import('a');\nimport.meta.url;\n", 'typescript')).toEqual([]);
    });
});

describe('comment run folds', () => {
    it('folds two or more lines of line comments in a row', () => {
        expect(folds('// one\n// two\n// three\ncode();\n// alone\nmore();', 'typescript')).toEqual([['line-comments', 0, 2]]);
        expect(folds('# one\n# two\nx = 1', 'python')).toEqual([['line-comments', 0, 1]]);
    });

    it('does not fold a language that has no line comments', () => {
        expect(folds('<!-- a -->\n<!-- b -->', 'html')).toEqual([]);
    });
});

describe('region folds', () => {
    it('folds from a region line to its end line, nested ones too', () => {
        const text = '// region outer\nconst a = 1;\n// region inner\nconst b = 2;\n// endregion\nconst c = 3;\n// endregion\n';
        expect(folds(text, 'typescript')).toEqual([
            ['region', 0, 6],
            ['region', 2, 4]
        ]);
    });

    it('reads the markers of other languages and ignores one without a partner', () => {
        expect(folds('#region A\nx\n#endregion', 'csharp')).toEqual([['region', 0, 2]]);
        expect(folds('# region A\nx = 1\n# endregion', 'python')).toEqual([['region', 0, 2]]);
        expect(folds('// region lonely\nx\n', 'typescript')).toEqual([]);
        expect(folds('// regionally\n// speaking\n', 'typescript')).toEqual([['line-comments', 0, 1]]);
    });

    it('keeps the markers out of a run of comments', () => {
        expect(folds('// region a\n// one\n// two\n// endregion', 'typescript')).toEqual([
            ['region', 0, 3],
            ['line-comments', 1, 2]
        ]);
    });
});

describe('without a language', () => {
    it('folds only brackets, block comments and indentation', () => {
        const model = new DocumentModel("import a from 'a';\nimport b from 'b';\n// c\n// d");
        expect(model.getFoldingRanges()).toEqual([]);
    });
});
