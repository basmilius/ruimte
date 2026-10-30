import { afterEach, beforeEach, describe, expect, spyOn, test } from 'bun:test';
import type { ReadOptionsWithBuffer } from 'node:fs';
import * as filesystem from 'node:fs/promises';
import { mkdir, mkdtemp, realpath, rename, rm, symlink, writeFile, type FileReadResult } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MachineHome } from './machine-home.ts';
import { isOpenName, isOpenPath, readSearchable, searchRoot, type SearchRoot } from './searchable.ts';

let root = '';
let project = '';
let home = '';
let search: SearchRoot;

beforeEach(async () => {
    root = await realpath(await mkdtemp(join(tmpdir(), 'ruimte-searchable-')));
    project = join(root, 'project');
    home = join(root, 'home');
    await mkdir(join(project, 'docs'), { recursive: true });
    await mkdir(join(home, 'keys'), { recursive: true });
    await writeFile(join(project, 'docs', 'key.txt'), 'plain words\n');
    await writeFile(join(home, 'keys', 'key.txt'), 'secret words\n');
    search = await searchRoot(project, await new MachineHome(home).policy());
});

afterEach(async () => {
    await rm(root, { recursive: true, force: true });
});

/* Puts the folder of secrets where `docs` was, as a link, and keeps the real one beside it. */
async function swapForLink(): Promise<void> {
    await rename(join(project, 'docs'), join(project, 'docs-real'));
    await symlink(join(home, 'keys'), join(project, 'docs'));
}

async function swapBack(): Promise<void> {
    await rm(join(project, 'docs'));
    await rename(join(project, 'docs-real'), join(project, 'docs'));
}

async function observeFile(content: string | Uint8Array) {
    const path = join(project, 'docs', 'key.txt');
    await writeFile(path, content);
    const handle = await filesystem.open(path, 'r');
    const reader: { read(options: ReadOptionsWithBuffer<Buffer>): Promise<FileReadResult<Buffer>> } = handle;
    const nativeRead = reader.read.bind(reader);
    let bytesRead = 0;
    const readAt = async (options: ReadOptionsWithBuffer<Buffer>): Promise<FileReadResult<Buffer>> => {
        const result = await nativeRead(options);
        bytesRead += result.bytesRead;

        return result;
    };

    const open = spyOn(filesystem, 'open').mockResolvedValue(handle);
    const read = spyOn(reader, 'read').mockImplementation(readAt);
    const readFile = spyOn(handle, 'readFile');
    const close = spyOn(handle, 'close');

    return {
        readAt,
        read,
        readFile,
        close,
        get bytesRead() {
            return bytesRead;
        },
        async dispose() {
            open.mockRestore();
            read.mockRestore();
            readFile.mockRestore();
            close.mockRestore();
            await handle.close().catch(() => undefined);
        }
    };
}

describe('readSearchable', () => {
    test('an early NUL rejects a large binary file without reading or decoding its body', async () => {
        const content = Buffer.alloc(2 * 1024 * 1024, 97);
        content[1023] = 0;
        const io = await observeFile(content);
        try {
            expect(await readSearchable(search, 'docs/key.txt')).toBeNull();
            expect(io.readFile).not.toHaveBeenCalled();
            expect(io.bytesRead).toBe(1024);
            expect(io.close).toHaveBeenCalledTimes(1);
        } finally {
            await io.dispose();
        }
    });

    test('short probe reads still find a NUL at the end of the probe', async () => {
        const content = Buffer.alloc(2048, 97);
        content[1023] = 0;
        const io = await observeFile(content);
        io.read.mockImplementation((options) => io.readAt({ ...options, length: Math.min(options?.length ?? 1024, 113) }));
        try {
            expect(await readSearchable(search, 'docs/key.txt')).toBeNull();
            expect(io.readFile).not.toHaveBeenCalled();
            expect(io.bytesRead).toBe(1024);
            expect(io.close).toHaveBeenCalledTimes(1);
        } finally {
            await io.dispose();
        }
    });

    test('text is read from its start with Unicode spanning the probe boundary', async () => {
        const content = 'é'.repeat(511) + '😀 tail\n'.repeat(100);
        const io = await observeFile(content);
        io.read.mockImplementation((options) => io.readAt({ ...options, length: Math.min(options?.length ?? 1024, 113) }));
        try {
            expect(await readSearchable(search, 'docs/key.txt')).toBe(content);
            expect(io.readFile).toHaveBeenCalledTimes(1);
            expect(io.close).toHaveBeenCalledTimes(1);
        } finally {
            await io.dispose();
        }
    });

    test.each([
        { name: 'empty text', text: '', expected: '' },
        { name: 'a NUL just outside the decoded prefix', text: 'a'.repeat(1024) + '\0tail', expected: 'a'.repeat(1024) + '\0tail' },
        { name: 'a Unicode NUL beyond the byte probe but inside the decoded prefix', text: '😀'.repeat(300) + '\0tail', expected: null },
        { name: 'a Unicode NUL outside the decoded prefix', text: 'é'.repeat(1024) + '\0tail', expected: 'é'.repeat(1024) + '\0tail' }
    ])('$name preserves the decoded-prefix policy', async ({ text, expected }) => {
        const io = await observeFile(text);
        try {
            expect(await readSearchable(search, 'docs/key.txt')).toBe(expected);
            expect(io.readFile).toHaveBeenCalledTimes(1);
            expect(io.close).toHaveBeenCalledTimes(1);
        } finally {
            await io.dispose();
        }
    });

    test('a NUL introduced after the probe is rejected by the final check', async () => {
        const io = await observeFile('a'.repeat(2048));
        io.read.mockImplementation(async (options) => {
            const result = await io.readAt(options);
            await writeFile(join(project, 'docs', 'key.txt'), '\0' + 'a'.repeat(2047));

            return result;
        });
        try {
            expect(await readSearchable(search, 'docs/key.txt')).toBeNull();
            expect(io.readFile).toHaveBeenCalledTimes(1);
            expect(io.close).toHaveBeenCalledTimes(1);
        } finally {
            await io.dispose();
        }
    });

    test('a file truncated during its probe reaches EOF without retaining old bytes', async () => {
        const io = await observeFile('old words');
        io.read.mockImplementation(async (options) => {
            await writeFile(join(project, 'docs', 'key.txt'), '');

            return await io.readAt(options);
        });
        try {
            expect(await readSearchable(search, 'docs/key.txt')).toBe('');
            expect(io.read).toHaveBeenCalledTimes(1);
            expect(io.close).toHaveBeenCalledTimes(1);
        } finally {
            await io.dispose();
        }
    });

    test('a failed probe closes the descriptor without reading the body', async () => {
        const io = await observeFile('plain words');
        io.read.mockRejectedValue(new Error('Read failed'));
        try {
            expect(await readSearchable(search, 'docs/key.txt')).toBeNull();
            expect(io.readFile).not.toHaveBeenCalled();
            expect(io.close).toHaveBeenCalledTimes(1);
        } finally {
            await io.dispose();
        }
    });

    test('reads a file of the folder searched', async () => {
        expect(await readSearchable(search, 'docs/key.txt')).toBe('plain words\n');
    });

    test('reads nothing through a folder that is a link', async () => {
        await swapForLink();
        expect(await readSearchable(search, 'docs/key.txt')).toBeNull();
    });

    test('a folder swapped for a link and back right after the open fails closed', async () => {
        await swapForLink();
        expect(await readSearchable(search, 'docs/key.txt', swapBack)).toBeNull();
    });

    test('a folder swapped for a link right after the open fails closed', async () => {
        expect(await readSearchable(search, 'docs/key.txt', swapForLink)).toBeNull();
    });
});

describe('names below a folder that holds the home', () => {
    test('are judged on the name and on where it leads', async () => {
        const above = await searchRoot(root, await new MachineHome(home).policy());
        await mkdir(join(home, 'scratch'), { recursive: true });
        await writeFile(join(home, 'scratch', 'note.md'), '');
        expect(isOpenName(above, 'home/keys/key.txt')).toBe(false);
        expect(isOpenName(above, 'home/scratch/note.md')).toBe(true);
        expect(await isOpenPath(above, 'project/docs/key.txt')).toBe(true);
        await swapForLink();
        expect(await isOpenPath(above, 'project/docs/key.txt')).toBe(false);
    });
});
