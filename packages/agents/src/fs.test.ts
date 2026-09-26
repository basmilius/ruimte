import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { writeAtomic } from './fs.ts';

let dir: string;

beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'ruimte-fs-'));
});

afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
});

describe('writeAtomic', () => {
    test('a durable write replaces the file whole, with its mode, and leaves no temp file behind', async () => {
        const target = join(dir, 'project.json');
        await writeFile(target, 'old');

        await writeAtomic(target, '{"rev":2}\n', 0o644, { durable: true });

        expect(await readFile(target, 'utf8')).toBe('{"rev":2}\n');
        expect(await readdir(dir)).toEqual(['project.json']);
        if (process.platform !== 'win32') {
            // A new file takes the mode it is created with, and the temp file is a new file.
            expect((await stat(target)).mode & 0o777).toBe(0o644);
        }
    });

    test('a durable write takes bytes as well as text', async () => {
        const target = join(dir, 'icon.png');
        await writeAtomic(target, new Uint8Array([0x89, 0x50, 0x4e, 0x47]), 0o600, { durable: true });
        expect([...(await readFile(target))]).toEqual([0x89, 0x50, 0x4e, 0x47]);
    });
});
