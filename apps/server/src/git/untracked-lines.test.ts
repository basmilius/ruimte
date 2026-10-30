import { afterAll, beforeAll, describe, expect, spyOn, test } from 'bun:test';
import * as fs from 'node:fs/promises';
import { mkdir, mkdtemp, rename, rm, symlink, truncate, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { untrackedNumstat } from './untracked-lines.ts';

let root: string;

beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), 'ruimte-untracked-'));
});

afterAll(async () => {
    await rm(root, { recursive: true, force: true });
});

async function counted(name: string, content: string | Uint8Array): Promise<unknown> {
    await writeFile(join(root, name), content);
    return await untrackedNumstat(root, name);
}

describe('untrackedNumstat', () => {
    test('unchanged counts reopen no content on the next read', async () => {
        const name = 'unchanged.txt';
        const absolute = join(root, name);
        await writeFile(absolute, 'one\ntwo\n');
        const opens = spyOn(fs, 'open');

        try {
            expect(await untrackedNumstat(root, name)).toEqual({ path: name, added: 2, deleted: 0, binary: false });
            expect(await untrackedNumstat(root, name)).toEqual({ path: name, added: 2, deleted: 0, binary: false });
            expect(opens.mock.calls.filter(([path]) => path === absolute)).toHaveLength(1);
        } finally {
            opens.mockRestore();
        }
    });

    test('every line is added, the last one too when it has no newline', async () => {
        expect(await counted('closed.txt', 'one\ntwo\n')).toEqual({ path: 'closed.txt', added: 2, deleted: 0, binary: false });
        expect(await counted('open.txt', 'one\ntwo')).toEqual({ path: 'open.txt', added: 2, deleted: 0, binary: false });
        expect(await counted('crlf.txt', 'one\r\ntwo\r\n')).toEqual({ path: 'crlf.txt', added: 2, deleted: 0, binary: false });
        expect(await counted('empty.txt', '')).toEqual({ path: 'empty.txt', added: 0, deleted: 0, binary: false });
    });

    test('lines are counted across the chunks a large file is read in', async () => {
        expect(await counted('large.txt', 'line\n'.repeat(50_000))).toMatchObject({ added: 50_000, binary: false });
    });

    test('a NUL near the start makes a file binary, one further in does not', async () => {
        expect(await counted('image.bin', new Uint8Array([0x89, 0x50, 0x00, 0x0a]))).toEqual({ path: 'image.bin', added: 0, deleted: 0, binary: true });
        const late = new Uint8Array(9000).fill(0x61);
        late[8500] = 0;
        late[8999] = 0x0a;
        expect(await counted('late.txt', late)).toMatchObject({ added: 1, binary: false });
    });

    test('a file growing during a count stops at the size limit while an exact-size file remains text', async () => {
        const limit = 512 * 1024 * 1024;
        const path = join(root, 'growing.txt');
        await writeFile(path, 'x');
        const originalOpen = fs.open;

        for (const size of [limit, limit + 5 * 64 * 1024]) {
            const handle = await originalOpen(path, 'r');
            let bytes = 0;

            const read = spyOn(handle, 'read').mockImplementation((async (buffer: Buffer, offset: number, length: number) => {
                const bytesRead = Math.min(length, size - bytes);
                buffer.fill(0x78, offset, offset + bytesRead);
                bytes += bytesRead;

                return { bytesRead, buffer };
            }) as typeof handle.read);

            const close = spyOn(handle, 'close');
            const open = spyOn(fs, 'open').mockImplementation((...args) =>
                args[0] === path ? Promise.resolve(handle) : Reflect.apply(originalOpen, fs, args)
            );

            try {
                expect(await untrackedNumstat(root, 'growing.txt')).toEqual({
                    path: 'growing.txt',
                    added: size === limit ? 1 : 0,
                    deleted: 0,
                    binary: size > limit
                });
                expect(bytes).toBe(Math.min(size, limit + 1));
                expect(close).toHaveBeenCalledTimes(1);
            } finally {
                open.mockRestore();
                read.mockRestore();
                close.mockRestore();
                if (handle.fd >= 0) {
                    await handle.close();
                }
            }
        }
    });

    test('a directory or a path that is gone counts nothing', async () => {
        await mkdir(join(root, 'folder'));
        expect(await untrackedNumstat(root, 'folder')).toBeNull();
        expect(await untrackedNumstat(root, 'missing.txt')).toBeNull();
    });

    test('ctime invalidates a same-size rewrite even when mtime is preserved', async () => {
        const name = 'preserved-mtime.txt';
        const absolute = join(root, name);
        await writeFile(absolute, 'a\nb\n');
        let version = 1n;
        const original = fs.lstat;
        const metadata = spyOn(fs, 'lstat').mockImplementation(async (path, options) => {
            const stat = await original(path, options);

            return path === absolute ? Object.assign(Object.create(stat), { mtimeNs: 10n, ctimeNs: version }) : stat;
        });

        try {
            expect(await untrackedNumstat(root, name)).toMatchObject({ added: 2 });
            await writeFile(absolute, 'abcd');
            version = 2n;
            expect(await untrackedNumstat(root, name)).toMatchObject({ added: 1 });
            expect(await untrackedNumstat(root, name)).toMatchObject({ added: 1 });
        } finally {
            metadata.mockRestore();
        }
    });

    test('an atomic replacement invalidates matching size and timestamps', async () => {
        const name = 'replaced.txt';
        const absolute = join(root, name);
        const replacement = join(root, 'replacement.txt');
        await writeFile(absolute, 'a\nb\n');
        await writeFile(replacement, 'abcd');
        const original = fs.lstat;
        const metadata = spyOn(fs, 'lstat').mockImplementation(async (path, options) => {
            const stat = await original(path, options);

            return path === absolute ? Object.assign(Object.create(stat), { mtimeNs: 10n, ctimeNs: 10n }) : stat;
        });

        try {
            expect(await untrackedNumstat(root, name)).toMatchObject({ added: 2 });
            await rename(replacement, absolute);
            expect(await untrackedNumstat(root, name)).toMatchObject({ added: 1 });
        } finally {
            metadata.mockRestore();
        }
    });

    test('missing and non-file paths cannot reuse a remembered file count', async () => {
        const name = 'removed.txt';
        const absolute = join(root, name);
        expect(await counted(name, 'a\nb\n')).toMatchObject({ added: 2 });
        await rm(absolute);
        expect(await untrackedNumstat(root, name)).toBeNull();
        await mkdir(absolute);
        expect(await untrackedNumstat(root, name)).toBeNull();
        await rm(absolute, { recursive: true });
        expect(await counted(name, 'new')).toMatchObject({ added: 1 });
    });

    test.skipIf(process.platform === 'win32')('a cached regular file replaced by a symlink is no longer counted', async () => {
        const name = 'linked.txt';
        const absolute = join(root, name);
        const target = join(root, 'link-target.txt');
        expect(await counted(name, 'a\nb\n')).toMatchObject({ added: 2 });
        await rename(absolute, target);
        await symlink(target, absolute);
        expect(await untrackedNumstat(root, name)).toBeNull();
    });

    test('a failed open is retried even when file metadata did not change', async () => {
        const name = 'temporarily-unreadable.txt';
        const absolute = join(root, name);
        await writeFile(absolute, 'line\n');
        const original = fs.open;
        let refused = true;
        const opens = spyOn(fs, 'open').mockImplementation((path, flags, mode) => {
            if (path === absolute && refused) {
                return Promise.reject(new Error('temporarily unavailable'));
            }

            return original(path, flags, mode);
        });

        try {
            expect(await untrackedNumstat(root, name)).toBeNull();
            refused = false;
            expect(await untrackedNumstat(root, name)).toMatchObject({ added: 1 });
            expect(opens.mock.calls.filter(([path]) => path === absolute)).toHaveLength(2);
        } finally {
            opens.mockRestore();
        }
    });

    test('a different file opened after the path check cannot poison remembered counts', async () => {
        const name = 'opened-identity.txt';
        const absolute = join(root, name);
        const other = join(root, 'other-identity.txt');
        await writeFile(absolute, 'a\nb\n');
        await writeFile(other, 'abcd');
        const original = fs.open;
        let redirected = true;
        const opens = spyOn(fs, 'open').mockImplementation((path, flags, mode) => {
            return original(path === absolute && redirected ? other : path, flags, mode);
        });

        try {
            expect(await untrackedNumstat(root, name)).toBeNull();
            redirected = false;
            expect(await untrackedNumstat(root, name)).toMatchObject({ added: 2 });
            expect(await untrackedNumstat(root, name)).toMatchObject({ added: 2 });
            expect(opens.mock.calls.filter(([path]) => path === absolute)).toHaveLength(2);
        } finally {
            opens.mockRestore();
        }
    });

    test('results belong to their caller and keep its relative spelling', async () => {
        const name = 'caller-owned.txt';
        await writeFile(join(root, name), 'a\nb\n');
        const first = await untrackedNumstat(root, name);

        if (first === null) {
            throw new Error('The fixture file was not counted');
        }

        first.added = 999;
        const alias = await untrackedNumstat(root, './caller-owned.txt');

        if (alias === null) {
            throw new Error('The fixture file was not counted');
        }

        expect(alias).toEqual({ path: './caller-owned.txt', added: 2, deleted: 0, binary: false });
        alias.added = 1000;
        expect(await untrackedNumstat(root, name)).toMatchObject({ path: name, added: 2 });
    });

    test('recently used counts survive while the oldest is evicted at the fixed limit', async () => {
        const name = 'evicted.txt';
        const absolute = join(root, name);
        await writeFile(absolute, 'old\n');
        const opens = spyOn(fs, 'open');

        try {
            await untrackedNumstat(root, name);

            for (let index = 0; index < 511; index += 1) {
                await counted(`evict-${index}.txt`, 'line\n');
            }

            expect(await untrackedNumstat(root, name)).toMatchObject({ added: 1 });
            await counted('evict-newest.txt', 'line\n');
            expect(await untrackedNumstat(root, name)).toMatchObject({ added: 1 });
            expect(await untrackedNumstat(root, 'evict-0.txt')).toMatchObject({ added: 1 });
            expect(opens.mock.calls.filter(([path]) => path === absolute)).toHaveLength(1);
            expect(opens.mock.calls.filter(([path]) => path === join(root, 'evict-0.txt'))).toHaveLength(2);
        } finally {
            opens.mockRestore();
        }
    });

    test('a sparse file above the existing size cap is binary without opening content', async () => {
        const name = 'above-limit.txt';
        const absolute = join(root, name);
        await writeFile(absolute, '');
        await truncate(absolute, 512 * 1024 * 1024 + 1);
        const original = fs.open;
        const opens = spyOn(fs, 'open').mockImplementation((path, flags, mode) => {
            if (path === absolute) {
                return Promise.reject(new Error('An oversized fixture must not be read'));
            }

            return original(path, flags, mode);
        });

        try {
            expect(await untrackedNumstat(root, name)).toEqual({ path: name, added: 0, deleted: 0, binary: true });
            expect(opens.mock.calls.filter(([path]) => path === absolute)).toHaveLength(0);
        } finally {
            opens.mockRestore();
        }
    });
});
