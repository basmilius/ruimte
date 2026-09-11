import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { GrepError, grepFiles } from './grep.ts';
import { forgetSearchCache } from './search.ts';

let root = '';

const seed = async (): Promise<void> => {
    await mkdir(join(root, 'src'), { recursive: true });
    await writeFile(
        join(root, 'src', 'session.ts'),
        ['import { spawn } from "bun";', '', 'export const startSession = (): void => {', '    spawn(["bash"]);', '};', ''].join('\n')
    );
    await writeFile(join(root, 'src', 'notes.md'), ['# Notes', '', 'A session is keyed by an id.', ''].join('\n'));
    await writeFile(join(root, 'src', 'unicode.ts'), ['const tree = "🌱 seedling";', 'const after = 1;', ''].join('\n'));
    await writeFile(join(root, 'src', 'binary.bin'), new Uint8Array([0, 115, 101, 115, 115, 105, 111, 110, 0]));
};

beforeEach(async () => {
    forgetSearchCache();
    root = await mkdtemp(join(tmpdir(), 'ruimte-grep-'));
    await seed();
});

afterEach(async () => {
    await rm(root, { recursive: true, force: true });
});

describe('grepFiles', () => {
    test('finds a literal across files and reads the lines around it', async () => {
        const result = await grepFiles(root, 'session');
        const paths = result.matches.map((match) => match.path).sort();
        expect(paths).toContain('src/session.ts');
        expect(paths).toContain('src/notes.md');
        expect(paths).not.toContain('src/binary.bin');
        const hit = result.matches.find((match) => match.path === 'src/session.ts' && match.line === 3)!;
        expect(hit.text).toContain('startSession');
        expect(hit.before.at(-1)).toBe('');
        expect(hit.after[0]).toBe('    spawn(["bash"]);');
    });

    test('points at the hit inside the line, counted the way a viewer draws it', async () => {
        const result = await grepFiles(root, 'seedling');
        const hit = result.matches.find((match) => match.path === 'src/unicode.ts')!;
        expect(hit.text.slice(hit.column, hit.column + hit.length)).toBe('seedling');
    });

    test('a literal query is not read as a pattern', async () => {
        expect((await grepFiles(root, 'spawn(["bash"])')).matches).toHaveLength(1);
        expect((await grepFiles(root, 's.ssion')).matches).toHaveLength(0);
    });

    test('searches as a regular expression when asked', async () => {
        const result = await grepFiles(root, 'start[A-Z]\\w+', { regex: true, caseSensitive: true });
        expect(result.matches.map((match) => match.line)).toEqual([3]);
    });

    test('case and whole words narrow what answers', async () => {
        expect((await grepFiles(root, 'SESSION', { caseSensitive: true })).matches).toHaveLength(0);
        expect((await grepFiles(root, 'session', { wholeWord: true })).matches.map((match) => match.path)).toEqual(['src/notes.md']);
    });

    test('stops at the limit and says so', async () => {
        const result = await grepFiles(root, 'e', { limit: 2 });
        expect(result.matches).toHaveLength(2);
        expect(result.truncated).toBe(true);
    });

    test('an empty query asks nothing of the disk', async () => {
        expect(await grepFiles(root, '   ')).toEqual({ matches: [], files: 0, truncated: false });
    });

    test('a pattern that is no pattern comes back as an error the client can show', async () => {
        expect(grepFiles(root, '(unclosed', { regex: true })).rejects.toThrow(GrepError);
    });
});

/* The same searches without ripgrep on PATH. Git goes with it, so the file list comes from the
   walk, which is exactly the machine this fallback exists for. */
describe('grepFiles without ripgrep', () => {
    let path = '';

    beforeEach(() => {
        path = process.env.PATH ?? '';
        process.env.PATH = '';
    });

    afterEach(() => {
        process.env.PATH = path;
    });

    test('finds a literal and reads the lines around it', async () => {
        const result = await grepFiles(root, 'session');
        expect(result.matches.map((match) => match.path).sort()).toEqual(['src/notes.md', 'src/session.ts']);
        const hit = result.matches.find((match) => match.path === 'src/session.ts')!;
        expect(hit.line).toBe(3);
        expect(hit.after[0]).toBe('    spawn(["bash"]);');
    });

    test('honors case, whole words and the limit', async () => {
        expect((await grepFiles(root, 'SESSION', { caseSensitive: true })).matches).toHaveLength(0);
        expect((await grepFiles(root, 'session', { wholeWord: true })).matches.map((match) => match.path)).toEqual(['src/notes.md']);
        expect((await grepFiles(root, 'e', { limit: 2 })).truncated).toBe(true);
    });

    test('skips a file that holds bytes nobody reads', async () => {
        expect((await grepFiles(root, 'session')).matches.some((match) => match.path === 'src/binary.bin')).toBe(false);
    });
});
