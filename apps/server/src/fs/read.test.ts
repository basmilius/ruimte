import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FS_READ_MAX_TEXT_BYTES } from '@ruimte/contracts';
import { ReadError, languageOf, looksBinary, looksLikeSvg, readFile, sniffMime } from './read.ts';

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d]);
const WEBP = Buffer.concat([Buffer.from('RIFF'), Buffer.from([0x20, 0x00, 0x00, 0x00]), Buffer.from('WEBPVP8 ')]);

let root: string;

const write = async (name: string, content: string | Buffer): Promise<string> => {
    const path = join(root, name);
    await writeFile(path, content);
    return path;
};

beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'ruimte-fs-read-'));
});

afterEach(async () => {
    await rm(root, { recursive: true, force: true });
});

describe('the binary sniff', () => {
    test('calls text text and bytes bytes', () => {
        expect(looksBinary(new Uint8Array(0))).toBe(false);
        expect(looksBinary(new TextEncoder().encode('const x = 1;\n\tconst y = 2;\r\n'))).toBe(false);
        expect(looksBinary(new TextEncoder().encode('\x1b[32mgreen\x1b[0m'))).toBe(false);
        expect(looksBinary(new TextEncoder().encode('een café in Wenen'))).toBe(false);
        expect(looksBinary(new Uint8Array([0x68, 0x69, 0x00, 0x68]))).toBe(true);
        expect(looksBinary(new Uint8Array([0x01, 0x02, 0x03, 0x04, 0x68, 0x69]))).toBe(true);
        // Latin-1 bytes are not valid UTF-8, so they are not text this viewer can show.
        expect(looksBinary(new Uint8Array([0x68, 0x69, 0xe9, 0x21]))).toBe(true);
    });

    test('names the formats it knows by their first bytes', () => {
        expect(sniffMime(new Uint8Array(PNG))).toBe('image/png');
        expect(sniffMime(new Uint8Array([0xff, 0xd8, 0xff, 0xe0]))).toBe('image/jpeg');
        expect(sniffMime(new TextEncoder().encode('GIF89a...'))).toBe('image/gif');
        expect(sniffMime(new Uint8Array(WEBP))).toBe('image/webp');
        expect(sniffMime(new TextEncoder().encode('%PDF-1.7'))).toBe('application/pdf');
        expect(sniffMime(new TextEncoder().encode('hello'))).toBeNull();
    });

    test('takes an SVG only when the file opens as one', () => {
        expect(looksLikeSvg(new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"></svg>'))).toBe(true);
        expect(looksLikeSvg(new TextEncoder().encode('<?xml version="1.0"?>\n<svg></svg>'))).toBe(true);
        expect(looksLikeSvg(new TextEncoder().encode('# Icons\n\nUse `<svg>` for the mark.'))).toBe(false);
    });
});

describe('fs.read', () => {
    test('reads a text file with its size, mtime and language', async () => {
        const path = await write('hello.ts', 'export const hello = 1;\n');
        const result = await readFile(path);
        expect(result).toMatchObject({ kind: 'text', text: 'export const hello = 1;\n', encoding: 'utf-8', size: 24, language: 'typescript' });
        expect(result.kind === 'text' && result.mtime).toBeGreaterThan(0);
    });

    test('leaves the language off for a name nothing recognizes', async () => {
        const result = await readFile(await write('notes', 'plain'));
        expect(result).toMatchObject({ kind: 'text', language: undefined });
    });

    test('picks a language up from a bare name too', () => {
        expect(languageOf('Dockerfile')).toBe('docker');
        expect(languageOf('.gitignore')).toBe('ignore');
        expect(languageOf('app.vue')).toBe('vue');
    });

    test('reports a binary file as its mime and never its bytes', async () => {
        expect(await readFile(await write('icon.png', PNG))).toMatchObject({ kind: 'binary', mime: 'image/png', size: PNG.length });
        expect(await readFile(await write('mark.svg', '<svg></svg>'))).toMatchObject({ kind: 'binary', mime: 'image/svg+xml' });
        expect(await readFile(await write('a.out', Buffer.from([0x7f, 0x45, 0x4c, 0x46, 0x00, 0x01])))).toMatchObject({
            kind: 'binary',
            mime: 'application/octet-stream'
        });
    });

    test('answers a text file past the cap with its size alone', async () => {
        const path = await write('huge.txt', 'x'.repeat(FS_READ_MAX_TEXT_BYTES + 1));
        expect(await readFile(path)).toEqual({ kind: 'too-large', size: FS_READ_MAX_TEXT_BYTES + 1 });
    });

    test('reads a file that sits exactly on the cap', async () => {
        const path = await write('big.txt', 'x'.repeat(FS_READ_MAX_TEXT_BYTES));
        expect((await readFile(path)).kind).toBe('text');
    });

    test('an image past the cap is still an image', async () => {
        const path = await write('big.png', Buffer.concat([PNG, Buffer.alloc(FS_READ_MAX_TEXT_BYTES)]));
        expect(await readFile(path)).toMatchObject({ kind: 'binary', mime: 'image/png' });
    });

    test('refuses a link, a folder, a missing file and a path that is not absolute', async () => {
        await write('real.txt', 'kept');
        await symlink(join(root, 'real.txt'), join(root, 'link.txt'));
        // A link is the one way a listed folder could hand the viewer a file it does not hold.
        await expect(readFile(join(root, 'link.txt'))).rejects.toThrow(ReadError);
        await expect(readFile(root)).rejects.toThrow(ReadError);
        await expect(readFile(join(root, 'nothing.txt'))).rejects.toThrow(ReadError);
        await expect(readFile('relative.txt')).rejects.toThrow(ReadError);
        await expect(readFile(`${join(root, 'real.txt')}\0.png`)).rejects.toThrow(ReadError);
    });
});
