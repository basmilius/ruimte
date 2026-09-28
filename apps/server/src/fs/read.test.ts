import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FS_READ_MAX_TEXT_BYTES } from '@ruimte/contracts';
import { ReadError, languageOf, looksBinary, readFile, readMedia } from './read.ts';
import { looksLikeSvg, sniffMime } from './sniff.ts';

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d]);
const WEBP = Buffer.concat([Buffer.from('RIFF'), Buffer.from([0x20, 0x00, 0x00, 0x00]), Buffer.from('WEBPVP8 ')]);

/* The head of an ISO base media file: a box length, `ftyp`, and the brand that says which flavor. */
const isoMedia = (brand: string): Buffer => Buffer.concat([Buffer.from([0x00, 0x00, 0x00, 0x20]), Buffer.from('ftyp'), Buffer.from(brand)]);

/* An `ftyp` box whose length covers the major brand, a minor version and the compatible brands. */
const ftyp = (major: string, ...compatible: string[]): Buffer => {
    const length = 16 + compatible.length * 4;
    return Buffer.concat([Buffer.from([0x00, 0x00, 0x00, length]), Buffer.from(`ftyp${major}`), Buffer.alloc(4), Buffer.from(compatible.join(''))]);
};

// An icon directory with one 16 by 16 entry, and a bitmap file header in front of a BITMAPINFOHEADER.
const ICO = Buffer.from([0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x10, 0x10, 0x00, 0x00, 0x01, 0x00, 0x20, 0x00, ...new Array(8).fill(0)]);
const BMP = Buffer.concat([Buffer.from('BM'), Buffer.from([0x46, 0x00, 0x00, 0x00, 0, 0, 0, 0, 0x36, 0, 0, 0, 0x28, 0, 0, 0]), Buffer.alloc(8)]);

const latin1 = (text: string): Uint8Array => new Uint8Array(Buffer.from(text, 'latin1'));

const ebml = (docType: string): Buffer =>
    Buffer.concat([Buffer.from([0x1a, 0x45, 0xdf, 0xa3]), Buffer.from([0x42, 0x82]), Buffer.from(docType), Buffer.alloc(16)]);

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

    test('names a picture in the ISO container by its brands, never as video', () => {
        // What an iPhone writes: the codec's brand first, the generic HEIF one behind it.
        expect(sniffMime(new Uint8Array(ftyp('heic', 'mif1', 'heic')))).toBe('image/heic');
        // The generic brand first and the codec's brand among the compatible ones.
        expect(sniffMime(new Uint8Array(ftyp('mif1', 'mif1', 'heic')))).toBe('image/heic');
        expect(sniffMime(new Uint8Array(ftyp('mif1', 'mif1', 'miaf')))).toBe('image/heif');
        expect(sniffMime(new Uint8Array(ftyp('avif', 'mif1', 'avif', 'miaf')))).toBe('image/avif');
        expect(sniffMime(new Uint8Array(ftyp('avis', 'msf1', 'avis')))).toBe('image/avif');
        expect(sniffMime(new Uint8Array(ftyp('isom', 'isom', 'avc1', 'mp41')))).toBe('video/mp4');
    });

    test('names the pictures with a signature of their own', () => {
        expect(sniffMime(new Uint8Array(ICO))).toBe('image/x-icon');
        expect(sniffMime(new Uint8Array(BMP))).toBe('image/bmp');
        expect(sniffMime(latin1('II*\x00\x08\x00\x00\x00'))).toBe('image/tiff');
        expect(sniffMime(latin1('MM\x00*\x00\x00\x00\x08'))).toBe('image/tiff');
        // The same few bytes with a header that does not hold up are no picture.
        expect(sniffMime(new Uint8Array([0x00, 0x00, 0x01, 0x00, 0x00, 0x00, ...new Array(16).fill(0)]))).toBeNull();
        expect(sniffMime(latin1('BM hello, this is a note'))).toBeNull();
    });

    test('names a video by its container and tells the flavors apart', () => {
        expect(sniffMime(new Uint8Array(isoMedia('isom')))).toBe('video/mp4');
        expect(sniffMime(new Uint8Array(isoMedia('mp42')))).toBe('video/mp4');
        expect(sniffMime(new Uint8Array(isoMedia('M4V ')))).toBe('video/mp4');
        expect(sniffMime(new Uint8Array(isoMedia('qt  ')))).toBe('video/quicktime');
        // Sound in the same container is no video.
        expect(sniffMime(new Uint8Array(isoMedia('M4A ')))).toBe('audio/mp4');
        expect(sniffMime(new Uint8Array(ebml('webm')))).toBe('video/webm');
        expect(sniffMime(new Uint8Array(ebml('matroska')))).toBe('video/x-matroska');
        expect(sniffMime(latin1('OggS\x00\x02' + '\x00'.repeat(22) + '\x80theora'))).toBe('video/ogg');
    });

    test('names sound by its container or its first frame', () => {
        expect(sniffMime(latin1('ID3\x04\x00'))).toBe('audio/mpeg');
        // An MP3 without a tag: MPEG-1 layer III, 128 kbit/s at 44.1 kHz.
        expect(sniffMime(new Uint8Array([0xff, 0xfb, 0x90, 0x64]))).toBe('audio/mpeg');
        expect(sniffMime(new Uint8Array([0xff, 0xf1, 0x50, 0x80]))).toBe('audio/aac');
        expect(sniffMime(latin1('RIFF\x24\x00\x00\x00WAVEfmt '))).toBe('audio/wav');
        expect(sniffMime(latin1('fLaC\x00\x00\x00\x22'))).toBe('audio/flac');
        expect(sniffMime(latin1('OggS\x00\x02' + '\x00'.repeat(22) + '\x13OpusHead'))).toBe('audio/ogg');
        expect(sniffMime(latin1('OggS\x00\x02' + '\x00'.repeat(22) + '\x01vorbis'))).toBe('audio/ogg');
        // The sync bits alone, with a bitrate that does not exist, are no MP3.
        expect(sniffMime(new Uint8Array([0xff, 0xfb, 0xf0, 0x00]))).toBeNull();
    });

    test('takes an SVG only when the file opens as one', () => {
        expect(looksLikeSvg(new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"></svg>'))).toBe(true);
        expect(looksLikeSvg(new TextEncoder().encode('<?xml version="1.0"?>\n<svg></svg>'))).toBe(true);
        expect(looksLikeSvg(new TextEncoder().encode('# Icons\n\nUse `<svg>` for the mark.'))).toBe(false);
    });
});

describe('fs.read', () => {
    test('reads a video as its mime and size, never as bytes over the socket', async () => {
        const path = await write('clip.mp4', Buffer.concat([isoMedia('isom'), Buffer.alloc(64)]));
        expect(await readFile(path)).toMatchObject({ kind: 'binary', mime: 'video/mp4', size: 76 });
    });

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

    test('reads a picture in the ISO container as that picture', async () => {
        const path = await write('IMG_0001.HEIC', Buffer.concat([ftyp('heic', 'mif1', 'heic'), Buffer.alloc(64)]));
        expect(await readFile(path)).toMatchObject({ kind: 'binary', mime: 'image/heic' });
    });

    test('hands the file route every picture, sound and PDF, and no other binary', async () => {
        const served = {
            'photo.heic': ftyp('heic', 'mif1', 'heic'),
            'photo.heif': ftyp('mif1', 'mif1', 'miaf'),
            'photo.avif': ftyp('avif', 'mif1', 'avif'),
            'favicon.ico': ICO,
            'picture.bmp': BMP,
            'scan.tiff': Buffer.from('II*\x00\x08\x00\x00\x00', 'latin1'),
            'paper.pdf': Buffer.from('%PDF-1.7\n')
        };
        const mimes = await Promise.all(Object.entries(served).map(async ([name, bytes]) => (await readMedia(await write(name, bytes)))?.mime));
        expect(mimes).toEqual(['image/heic', 'image/heif', 'image/avif', 'image/x-icon', 'image/bmp', 'image/tiff', 'application/pdf']);
        expect(await readMedia(await write('a.out', Buffer.from([0x7f, 0x45, 0x4c, 0x46, 0x00, 0x01])))).toBeNull();
        expect(await readMedia(await write('notes.md', '# hello'))).toBeNull();
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
