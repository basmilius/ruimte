import { describe, expect, test } from 'bun:test';
import type { FsReadResult } from '@ruimte/contracts';
import {
    DEFAULT_INDENTATION,
    editorConfigDirs,
    globToRegExp,
    indentationFor,
    loadEditorConfigs,
    parseEditorConfig,
    resolveIndentation,
    resolveMaxLineLength
} from '@/shell/panels/editor-config';

const file = (dir: string, text: string) => ({ dir, config: parseEditorConfig(text) });

describe('parseEditorConfig', () => {
    test('reads the preamble, sections and lowercases keys and values', () => {
        const config = parseEditorConfig('# note\nRoot = TRUE\n\n[*.ts]\nIndent_Style = Tab\n; another\nindent_size=2\n[*.md]\ntrim = x');
        expect(config.root).toBe(true);
        expect(config.sections).toEqual([
            { glob: '*.ts', properties: { indent_style: 'tab', indent_size: '2' } },
            { glob: '*.md', properties: { trim: 'x' } }
        ]);
    });

    test('skips lines it cannot read and handles CRLF', () => {
        const config = parseEditorConfig('[*]\r\nnonsense\r\nindent_size = 3\r\n');
        expect(config.sections[0]!.properties).toEqual({ indent_size: '3' });
        expect(config.root).toBe(false);
    });
});

describe('globToRegExp', () => {
    test('matches a name at any depth when the glob has no slash', () => {
        const glob = globToRegExp('*.ts');
        expect(glob.test('a.ts')).toBe(true);
        expect(glob.test('src/deep/a.ts')).toBe(true);
        expect(glob.test('a.tsx')).toBe(false);
    });

    test('anchors a glob with a slash to the folder', () => {
        expect(globToRegExp('src/*.ts').test('src/a.ts')).toBe(true);
        expect(globToRegExp('src/*.ts').test('lib/src/a.ts')).toBe(false);
        expect(globToRegExp('/a.ts').test('x/a.ts')).toBe(false);
        expect(globToRegExp('src/**.ts').test('src/a/b.ts')).toBe(true);
        expect(globToRegExp('src/**/a.ts').test('src/a.ts')).toBe(true);
    });

    test('knows braces, ranges, sets and the single character', () => {
        const braces = globToRegExp('*.{ts,tsx}');
        expect(braces.test('a.tsx')).toBe(true);
        expect(braces.test('a.js')).toBe(false);
        expect(globToRegExp('v{1..3}.txt').test('v2.txt')).toBe(true);
        expect(globToRegExp('v{1..3}.txt').test('v4.txt')).toBe(false);
        expect(globToRegExp('[ab].x').test('b.x')).toBe(true);
        expect(globToRegExp('[!ab].x').test('b.x')).toBe(false);
        expect(globToRegExp('?.x').test('ab.x')).toBe(false);
    });

    test('takes a star that is part of a name literally when escaped', () => {
        expect(globToRegExp('a\\*b').test('a*b')).toBe(true);
        expect(globToRegExp('a\\*b').test('axb')).toBe(false);
    });
});

describe('resolveMaxLineLength', () => {
    test('reads the number of the sections that match and nothing when there is none or it is off', () => {
        const files = [file('/repo', '[*]\nmax_line_length = 100\n[*.md]\nmax_line_length = off\n[*.php]\nmax_line_length = 120')];
        expect(resolveMaxLineLength(files, '/repo/a.ts')).toBe(100);
        expect(resolveMaxLineLength(files, '/repo/a.php')).toBe(120);
        expect(resolveMaxLineLength(files, '/repo/a.md')).toBeNull();
        expect(resolveMaxLineLength([file('/repo', '[*]\nindent_size = 2')], '/repo/a.ts')).toBeNull();
        expect(resolveMaxLineLength([], '/repo/a.ts')).toBeNull();
    });
});

describe('resolveIndentation', () => {
    test('reads the size and style of the first section that matches, later sections win', () => {
        const files = [file('/repo', '[*]\nindent_style = space\nindent_size = 4\n[*.ts]\nindent_size = 2')];
        expect(resolveIndentation(files, '/repo/a.ts')).toEqual({ tabSize: 2, insertSpaces: true });
        expect(resolveIndentation(files, '/repo/a.php')).toEqual({ tabSize: 4, insertSpaces: true });
    });

    test('lets a nearer file win and a root file end the walk', () => {
        const near = file('/repo/web', '[*]\nindent_size = 2');
        const far = file('/repo', '[*]\nindent_size = 8\nindent_style = tab');
        expect(resolveIndentation([near, far], '/repo/web/a.ts')).toEqual({ tabSize: 2, insertSpaces: false });
        const rooted = file('/repo/web', 'root = true\n[*]\nindent_size = 2');
        expect(resolveIndentation([rooted, far], '/repo/web/a.ts')).toEqual({ tabSize: 2 });
    });

    test('uses tab_width for tabs and falls back to indent_size', () => {
        expect(resolveIndentation([file('/r', '[*]\nindent_style = tab\ntab_width = 8\nindent_size = 4')], '/r/a')).toEqual({
            tabSize: 8,
            insertSpaces: false
        });
        expect(resolveIndentation([file('/r', '[*]\nindent_style = tab\nindent_size = 3')], '/r/a')).toEqual({ tabSize: 3, insertSpaces: false });
        expect(resolveIndentation([file('/r', '[*]\nindent_size = tab\ntab_width = 6')], '/r/a')).toEqual({ tabSize: 6 });
    });

    test('ignores a size that is not a number and a section of another folder', () => {
        expect(resolveIndentation([file('/r', '[*]\nindent_size = lots')], '/r/a')).toEqual({});
        expect(resolveIndentation([file('/other', '[*]\nindent_size = 2')], '/r/a')).toEqual({});
    });
});

describe('loading', () => {
    const roots = ['/repo'];

    test('walks from the file up to the project folder and no further', () => {
        expect(editorConfigDirs('/repo/a/b/c.ts', roots)).toEqual(['/repo/a/b', '/repo/a', '/repo']);
        expect(editorConfigDirs('/elsewhere/x/c.ts', roots)).toEqual(['/elsewhere/x']);
        expect(editorConfigDirs('/repo/c.ts', roots)).toEqual(['/repo']);
    });

    function reader(files: Record<string, string>): { read: (path: string) => Promise<FsReadResult>; asked: string[] } {
        const asked: string[] = [];
        return {
            asked,
            read: async (path) => {
                asked.push(path);
                const text = files[path];
                if (text === undefined) {
                    throw new Error('missing');
                }
                return { kind: 'text', text, encoding: 'utf-8', size: text.length, mtime: 0 };
            }
        };
    }

    test('stops reading at a root file', async () => {
        const { read, asked } = reader({ '/repo/a/.editorconfig': 'root = true\n[*]\nindent_size = 2', '/repo/.editorconfig': '[*]\nindent_size = 8' });
        const files = await loadEditorConfigs('/repo/a/b.ts', roots, read);
        expect(files.map((entry) => entry.dir)).toEqual(['/repo/a']);
        expect(asked).toEqual(['/repo/a/.editorconfig']);
    });

    test('falls back to the default without a file and merges what a file says', async () => {
        expect(await indentationFor('/repo/a.ts', roots, reader({}).read)).toEqual(DEFAULT_INDENTATION);
        const read = reader({ '/repo/.editorconfig': '[*]\nindent_style = tab' }).read;
        expect(await indentationFor('/repo/a.ts', roots, read)).toEqual({ tabSize: 4, insertSpaces: false });
    });
});
