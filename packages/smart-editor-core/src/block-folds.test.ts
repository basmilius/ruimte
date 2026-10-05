import { describe, expect, it } from 'bun:test';
import { DocumentModel } from './document.ts';

function folds(text: string, language: string) {
    return new DocumentModel(text).getFoldingRanges({ language }).map((range) => [range.kind, range.role ?? null, range.startLine, range.endLine]);
}

describe('Markdown folds', () => {
    it('folds front matter, code fences and tables', () => {
        const text = '---\ntitle: a\n---\n\n```ts\nconst a = 1;\n```\n\n| a | b |\n|---|---|\n| 1 | 2 |\n\ntext';
        expect(folds(text, 'markdown')).toEqual([
            ['block', 'front-matter', 0, 2],
            ['block', 'code-fence', 4, 6],
            ['block', 'table', 8, 10]
        ]);
    });

    it('folds the section under a heading up to the next heading of its level or above', () => {
        const text = '# One\n\nintro\n\n## Two\n\nbody\n\n### Three\n\ndeep\n\n## Four\n\nlast\n';
        expect(folds(text, 'markdown')).toEqual([
            ['section', null, 0, 14],
            ['section', null, 4, 10],
            ['section', null, 8, 10],
            ['section', null, 12, 14]
        ]);
    });

    it('does not read what a fence holds as a heading, and leaves an unclosed fence alone', () => {
        expect(folds('```\n# not a heading\ntext\n```', 'markdown')).toEqual([['block', 'code-fence', 0, 3]]);
        expect(folds('```\nopen\nforever', 'markdown')).toEqual([]);
    });

    it('closes a fence only on a line of the same character', () => {
        expect(folds('````\n```\ninside\n```\n````', 'markdown')).toEqual([['block', 'code-fence', 0, 4]]);
    });
});

describe('PHP folds', () => {
    it('folds a heredoc and a nowdoc up to their closing line', () => {
        const text = "<?php\n$a = <<<EOT\n    one\n    two\nEOT;\n$b = <<<'RAW'\n    x\n    y\nRAW;\n";
        expect(folds(text, 'php')).toEqual([
            ['block', 'heredoc', 1, 4],
            ['block', 'heredoc', 5, 8]
        ]);
    });

    it('folds a PHP block between markup, and not the one that opens the file', () => {
        const text = '<?php\nrun();\n?>\n<ul>\n<?php foreach ($a as $b):\n    echo $b;\n?>\n</ul>';
        expect(folds(text, 'php')).toEqual([['block', 'php-tag', 4, 6]]);
    });

    it('leaves a one-line tag alone', () => {
        expect(folds('<p><?= $a ?></p>\n<p>b</p>', 'php')).toEqual([]);
    });
});
