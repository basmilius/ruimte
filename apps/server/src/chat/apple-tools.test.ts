import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { executeAppleTool, type AppleToolCall } from './apple-tools.ts';

let project: string;
let outside: string;

beforeEach(async () => {
    project = await mkdtemp(join(tmpdir(), 'ruimte-apple-tools-'));
    outside = await mkdtemp(join(tmpdir(), 'ruimte-apple-outside-'));
});

afterEach(async () => {
    await Promise.all([rm(project, { recursive: true, force: true }), rm(outside, { recursive: true, force: true })]);
});

const read = (path: string, offset = 0): Extract<AppleToolCall, { name: 'read_file' }> => ({ type: 'tool.call', id: 'read', name: 'read_file', path, offset });
const list = (path = '.'): AppleToolCall => ({ type: 'tool.call', id: 'list', name: 'list_files', path });

describe('Apple project tools', () => {
    test('lists project files and directories without hidden state or credentials', async () => {
        await mkdir(join(project, 'src'));
        await mkdir(join(project, '.ruimte'));
        await Promise.all(['README.md', '.gitignore', '.env', 'credentials.json', 'private.key'].map((name) => writeFile(join(project, name), 'test')));
        const result = await executeAppleTool(project, list());
        expect(result.failed).toBe(false);
        expect(JSON.parse(result.output)).toEqual({
            path: '.',
            entries: [
                { name: '.gitignore', kind: 'file' },
                { name: 'README.md', kind: 'file' },
                { name: 'src', kind: 'directory' }
            ],
            truncated: false
        });
    });

    test('bounds directory output', async () => {
        await Promise.all(Array.from({ length: 45 }, (_, index) => writeFile(join(project, `entry-${index}.txt`), '')));
        const result = await executeAppleTool(project, list());
        expect(JSON.parse(result.output).entries).toHaveLength(40);
        expect(JSON.parse(result.output).truncated).toBe(true);
        expect(Buffer.byteLength(result.output)).toBeLessThanOrEqual(6000);
    });

    test('reads zero-based line pages and returns the next offset', async () => {
        await mkdir(join(project, 'src'));
        await writeFile(join(project, 'src/notes.txt'), Array.from({ length: 35 }, (_, index) => `Line ${index}`).join('\n') + '\n');
        const first = await executeAppleTool(project, { ...read('src/notes.txt'), limit: 30 });
        expect(first.failed).toBe(false);
        expect(JSON.parse(first.output)).toEqual({
            path: 'src/notes.txt',
            offset: 0,
            totalLines: 35,
            content: Array.from({ length: 30 }, (_, index) => `Line ${index}`).join('\n'),
            nextOffset: 30,
            truncated: true,
            notice: 'Partial file. Continue Read at nextOffset to read the remaining lines.'
        });
        const last = await executeAppleTool(project, read('src/notes.txt', 30));
        expect(JSON.parse(last.output)).toEqual({
            path: 'src/notes.txt',
            offset: 30,
            totalLines: 35,
            content: 'Line 30\nLine 31\nLine 32\nLine 33\nLine 34',
            nextOffset: null,
            truncated: false
        });
    });

    test('reads a modest README through its final section by default', async () => {
        const lines = Array.from({ length: 77 }, (_, index) => `Line ${index}: ${'documentation '.repeat(3)}`);
        lines[76] = '## License: MIT';
        await writeFile(join(project, 'README.md'), lines.join('\n') + '\n');
        const result = await executeAppleTool(project, read('README.md'));
        expect(result.failed).toBe(false);
        expect(JSON.parse(result.output)).toMatchObject({ content: lines.join('\n'), totalLines: 77, nextOffset: null, truncated: false });
        expect(Buffer.byteLength(result.output)).toBeLessThanOrEqual(6000);
    });

    test('default pages cover the whole file without losing lines', async () => {
        const lines = Array.from({ length: 225 }, (_, index) => `Line ${index}`);
        await writeFile(join(project, 'long.txt'), lines.join('\n'));
        const collected: string[] = [];
        let offset = 0;
        for (let pageIndex = 0; pageIndex < 3; pageIndex++) {
            const result = await executeAppleTool(project, read('long.txt', offset));
            expect(result.failed).toBe(false);
            const page = JSON.parse(result.output);
            expect(page.totalLines).toBe(225);
            collected.push(...page.content.split('\n'));
            if (page.nextOffset === null) {
                expect(page.truncated).toBe(false);
                break;
            }
            expect(page.nextOffset).toBeGreaterThan(offset);
            expect(page.notice).toContain('Partial file');
            offset = page.nextOffset;
        }
        expect(collected).toEqual(lines);
    });

    test('bounds UTF-8 output including JSON metadata without splitting a line', async () => {
        await writeFile(join(project, 'unicode.txt'), Array.from({ length: 30 }, () => '🙂'.repeat(100)).join('\n'));
        const result = await executeAppleTool(project, read('unicode.txt'));
        expect(result.failed).toBe(false);
        expect(Buffer.byteLength(result.output)).toBeLessThanOrEqual(6000);
        const page = JSON.parse(result.output);
        expect(page.truncated).toBe(true);
        expect(page.nextOffset).toBeGreaterThan(0);
        expect(page.content.split('\n')).toEqual(Array.from({ length: page.nextOffset }, () => '🙂'.repeat(100)));
    });

    test('rejects one oversized line instead of skipping its remainder', async () => {
        await writeFile(join(project, 'long.txt'), 'a'.repeat(6000));
        expect((await executeAppleTool(project, read('long.txt'))).failed).toBe(true);
    });

    test.each([
        '../outside',
        'src/../../outside',
        '/etc/passwd',
        'src\\file',
        '.env',
        '.env.local',
        '.git/config',
        '.ruimte/private/project.json',
        'credentials.json',
        'secrets.yaml',
        'private.pem'
    ])('rejects protected or escaping path %s', async (path) => {
        expect((await executeAppleTool(project, read(path))).failed).toBe(true);
        expect((await executeAppleTool(project, list(path))).failed).toBe(true);
    });

    test('rejects symlink files and directories, including targets inside the project', async () => {
        await writeFile(join(outside, 'secret.txt'), 'outside secret');
        await writeFile(join(project, 'normal.txt'), 'normal');
        await symlink(join(outside, 'secret.txt'), join(project, 'escape.txt'));
        await symlink(outside, join(project, 'escape'));
        await symlink(join(project, 'normal.txt'), join(project, 'alias.txt'));
        for (const path of ['escape.txt', 'escape/secret.txt', 'alias.txt']) {
            const result = await executeAppleTool(project, read(path));
            expect(result.failed).toBe(true);
            expect(result.output).not.toContain('outside secret');
        }
        expect((await executeAppleTool(project, list('escape'))).failed).toBe(true);
        expect(JSON.parse((await executeAppleTool(project, list())).output).entries).toEqual([{ name: 'normal.txt', kind: 'file' }]);
    });

    test('rejects binary, invalid UTF-8, oversized files, and directories', async () => {
        await writeFile(join(project, 'binary'), Buffer.from([65, 0, 66]));
        await writeFile(join(project, 'invalid'), Buffer.from([0xff, 0xfe]));
        await writeFile(join(project, 'large'), Buffer.alloc(256 * 1024 + 1, 65));
        for (const path of ['binary', 'invalid', 'large', '.']) {
            expect((await executeAppleTool(project, read(path))).failed).toBe(true);
        }
    });

    test('handles empty files and rejects invalid offsets', async () => {
        await writeFile(join(project, 'empty'), '');
        const result = await executeAppleTool(project, read('empty'));
        expect(JSON.parse(result.output)).toEqual({ path: 'empty', offset: 0, totalLines: 0, content: '', nextOffset: null, truncated: false });
        for (const offset of [-1, 0.5, 1]) {
            expect((await executeAppleTool(project, read('empty', offset))).failed).toBe(true);
        }
    });

    test('rejects cancellation before access and during an asynchronous read', async () => {
        await writeFile(join(project, 'normal.txt'), 'private content');
        const before = new AbortController();
        before.abort();
        await expect(executeAppleTool(project, read('normal.txt'), before.signal)).rejects.toThrow();
        const during = new AbortController();
        const pending = executeAppleTool(project, read('normal.txt'), during.signal);
        during.abort();
        await expect(pending).rejects.toThrow();
    });
});

describe('Apple coding tools', () => {
    test('reads an explicit number of lines', async () => {
        await writeFile(join(project, 'many.txt'), Array.from({ length: 120 }, (_, index) => `${index}`).join('\n'));
        const result = await executeAppleTool(project, { ...read('many.txt', 10), limit: 50 } as AppleToolCall);
        expect(JSON.parse(result.output)).toMatchObject({ offset: 10, nextOffset: 60, truncated: true });
        expect(JSON.parse(result.output).content.split('\n')).toHaveLength(50);
    });

    test('searches literal text with glob filtering and skips excluded directories', async () => {
        await mkdir(join(project, 'src'));
        await mkdir(join(project, 'node_modules'));
        await mkdir(join(project, 'ignored'));
        await writeFile(join(project, '.gitignore'), 'ignored/\n*.log\n');
        await writeFile(join(project, 'src/index.ts'), 'first\nfind [literal].* here\nlast');
        await writeFile(join(project, 'src/readme.md'), 'find [literal].*');
        await writeFile(join(project, 'src/debug.log'), 'find [literal].*');
        await writeFile(join(project, 'node_modules/lib.ts'), 'find [literal].*');
        await writeFile(join(project, 'ignored/private.ts'), 'find [literal].*');
        await writeFile(join(project, '.env'), 'find [literal].*');
        const result = await executeAppleTool(project, {
            type: 'tool.call',
            id: 'search',
            name: 'search_files',
            path: '.',
            query: '[literal].*',
            glob: '**/*.ts'
        });
        expect(result.failed).toBe(false);
        expect(JSON.parse(result.output)).toMatchObject({ matches: [{ path: 'src/index.ts', line: 2, text: 'find [literal].* here' }], truncated: false });
    });

    test('search bounds matches and skips symlinks and binary data', async () => {
        await writeFile(join(outside, 'secret.txt'), 'needle');
        await symlink(join(outside, 'secret.txt'), join(project, 'escape'));
        await writeFile(join(project, 'binary'), Buffer.from('needle\0'));
        await writeFile(join(project, 'matches.txt'), Array.from({ length: 100 }, () => 'needle').join('\n'));
        const result = await executeAppleTool(project, { type: 'tool.call', id: 'search', name: 'search_files', path: '.', query: 'needle' });
        const parsed = JSON.parse(result.output);
        expect(parsed.truncated).toBe(true);
        expect(parsed.matches).toHaveLength(30);
        expect(parsed.matches.every((match: { path: string }) => match.path === 'matches.txt')).toBe(true);
        expect(Buffer.byteLength(result.output)).toBeLessThanOrEqual(6000);
    });

    test('creates a new file and reports the change, but refuses an overwrite', async () => {
        const call: AppleToolCall = { type: 'tool.call', id: 'write', name: 'write_file', path: 'new.txt', content: 'new contents\n' };
        const result = await executeAppleTool(project, call);
        expect(result.failed).toBe(false);
        expect(result.changes).toEqual([{ path: 'new.txt', kind: 'add', diff: '' }]);
        expect(await Bun.file(join(project, 'new.txt')).text()).toBe('new contents\n');
        expect((await executeAppleTool(project, { ...call, content: 'overwrite' })).failed).toBe(true);
        expect(await Bun.file(join(project, 'new.txt')).text()).toBe('new contents\n');
    });

    test('replaces unique exact text and truncates the previous file contents', async () => {
        await writeFile(join(project, 'edit.txt'), 'before\nunique old text\nafter\n');
        const result = await executeAppleTool(project, {
            type: 'tool.call',
            id: 'edit',
            name: 'edit_file',
            path: 'edit.txt',
            oldText: 'unique old text',
            newText: 'new'
        });
        expect(result.failed).toBe(false);
        expect(result.changes).toEqual([{ path: 'edit.txt', kind: 'update', diff: '' }]);
        expect(await Bun.file(join(project, 'edit.txt')).text()).toBe('before\nnew\nafter\n');
    });

    test('rejects ambiguous or stale edits without changing the file', async () => {
        await writeFile(join(project, 'edit.txt'), 'same\nsame\n');
        for (const oldText of ['same', 'missing', '']) {
            const result = await executeAppleTool(project, { type: 'tool.call', id: 'edit', name: 'edit_file', path: 'edit.txt', oldText, newText: 'changed' });
            expect(result.failed).toBe(true);
            expect(result.recoverable).toBe(oldText ? true : undefined);
            if (oldText) {
                expect(result.output).toContain('No file was changed');
            }
            expect(await Bun.file(join(project, 'edit.txt')).text()).toBe('same\nsame\n');
        }
    });

    test('refuses writes through symlinks and protected paths', async () => {
        await writeFile(join(outside, 'original'), 'original');
        await symlink(outside, join(project, 'linked'));
        await symlink(join(outside, 'original'), join(project, 'linked-file'));
        for (const path of ['../escape.txt', '.env', 'linked/new.txt', 'linked-file']) {
            expect((await executeAppleTool(project, { type: 'tool.call', id: 'write', name: 'write_file', path, content: 'changed' })).failed).toBe(true);
            expect(
                (await executeAppleTool(project, { type: 'tool.call', id: 'edit', name: 'edit_file', path, oldText: 'original', newText: 'changed' })).failed
            ).toBe(true);
        }
        expect(await Bun.file(join(outside, 'original')).text()).toBe('original');
        expect(await Bun.file(join(outside, 'new.txt')).exists()).toBe(false);
    });

    test('rejects oversized and non-text changes', async () => {
        await writeFile(join(project, 'edit.txt'), 'original');
        for (const content of ['a'.repeat(256 * 1024 + 1), 'binary\0']) {
            expect((await executeAppleTool(project, { type: 'tool.call', id: 'write', name: 'write_file', path: 'new.txt', content })).failed).toBe(true);
            expect(
                (await executeAppleTool(project, { type: 'tool.call', id: 'edit', name: 'edit_file', path: 'edit.txt', oldText: 'original', newText: content }))
                    .failed
            ).toBe(true);
        }
        expect(await Bun.file(join(project, 'new.txt')).exists()).toBe(false);
        expect(await Bun.file(join(project, 'edit.txt')).text()).toBe('original');
    });

    test('aborted changes never start', async () => {
        const controller = new AbortController();
        controller.abort();
        await expect(
            executeAppleTool(project, { type: 'tool.call', id: 'write', name: 'write_file', path: 'new.txt', content: 'text' }, controller.signal)
        ).rejects.toThrow();
        expect(await Bun.file(join(project, 'new.txt')).exists()).toBe(false);
    });
});
