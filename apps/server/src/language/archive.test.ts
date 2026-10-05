import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { extractEntries, readArchive } from './archive.ts';
import { tarGz, zip, type FixtureFile } from './test-archives.ts';

let folder = '';

beforeEach(async () => {
    folder = await mkdtemp(join(tmpdir(), 'ruimte-archive-'));
});

afterEach(async () => {
    await rm(folder, { recursive: true, force: true });
});

const FILES: FixtureFile[] = [
    { path: 'bin/server', text: '#!/bin/sh\n', mode: 0o755 },
    { path: 'docs/readme.txt', text: 'hello' }
];

describe('archives', () => {
    for (const format of ['tar.gz', 'zip'] as const) {
        it(`reads the files and modes of a ${format}`, () => {
            const entries = readArchive(format === 'zip' ? zip(FILES) : tarGz(FILES), format);
            expect(entries.map((entry) => entry.path)).toEqual(['bin/server', 'docs/readme.txt']);
            expect(entries.map((entry) => new TextDecoder().decode(entry.data))).toEqual(['#!/bin/sh\n', 'hello']);
            expect(entries[0]!.mode & 0o777).toBe(0o755);
        });

        it(`writes a ${format} under a folder, executable where the archive says so`, async () => {
            await extractEntries(readArchive(format === 'zip' ? zip(FILES) : tarGz(FILES), format), folder);
            expect(await readFile(join(folder, 'docs', 'readme.txt'), 'utf8')).toBe('hello');
            expect((await stat(join(folder, 'bin', 'server'))).mode & 0o111).not.toBe(0);
            expect((await stat(join(folder, 'docs', 'readme.txt'))).mode & 0o111).toBe(0);
        });
    }

    it('reads a name that only fits in the prefix of a tar header', () => {
        const path = `${'deep/'.repeat(30)}file.php`;
        expect(readArchive(tarGz([{ path, text: '<?php' }]), 'tar.gz').map((entry) => entry.path)).toEqual([path]);
    });

    it('strips leading folders and keeps only what the filter wants', async () => {
        const written = await extractEntries(
            readArchive(
                tarGz([
                    { path: 'repo-abc/a.php', text: '1' },
                    { path: 'repo-abc/b.md', text: '2' },
                    { path: 'repo-abc/LICENSE', text: '3' }
                ]),
                'tar.gz'
            ),
            folder,
            {
                strip: 1,
                keep: (path) => path.endsWith('.php') || path === 'LICENSE'
            }
        );
        expect(written).toEqual(['a.php', 'LICENSE']);
    });

    it('never writes outside the folder it was given', async () => {
        const written = await extractEntries(
            [
                { path: '../escape.txt', data: new Uint8Array(), mode: 0o644 },
                { path: 'a/../../escape2.txt', data: new Uint8Array(), mode: 0o644 },
                { path: '/etc/absolute.txt', data: new Uint8Array(), mode: 0o644 }
            ],
            folder
        );
        expect(written).toEqual([]);
    });

    it('refuses something that is no zip and an archive that ends early', () => {
        expect(() => readArchive(new Uint8Array(40), 'zip')).toThrow('not a zip');
        expect(() => readArchive(tarGz([{ path: 'a', text: 'x'.repeat(2000) }]).subarray(0, 40), 'tar.gz')).toThrow();
    });
});
