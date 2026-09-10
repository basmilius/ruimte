import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { deriveIdentity, faviconHref, sniffMime, IdentityCache, ICON_MAX_BYTES } from './project-identity.ts';

let root: string;
let folder: string;
let outside: string;

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d]);
const SVG = Buffer.from('<?xml version="1.0"?>\n<svg xmlns="http://www.w3.org/2000/svg"><rect width="8" height="8" /></svg>');
const GIF = Buffer.from([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0x01, 0x00]);

const put = async (relative: string, bytes: Uint8Array | string): Promise<string> => {
    const path = join(folder, relative);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, bytes);
    return path;
};

beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'ruimte-identity-'));
    folder = join(root, 'repo');
    outside = join(root, 'private');
    await mkdir(folder);
    await mkdir(outside);
});

afterEach(async () => {
    await rm(root, { recursive: true, force: true });
});

describe('sniffMime', () => {
    test('reads the type from the bytes, not from the name', () => {
        expect(sniffMime(PNG)).toBe('image/png');
        expect(sniffMime(SVG)).toBe('image/svg+xml');
        expect(sniffMime(GIF)).toBe('image/gif');
        expect(sniffMime(Buffer.from([0xff, 0xd8, 0xff, 0xe0]))).toBe('image/jpeg');
        expect(sniffMime(Buffer.from('RIFF____WEBPVP8 '))).toBe('image/webp');
        expect(sniffMime(Buffer.from([0x00, 0x00, 0x01, 0x00, 0x01, 0x00]))).toBe('image/vnd.microsoft.icon');
        // An .ico header with image type 2 is a cursor.
        expect(sniffMime(Buffer.from([0x00, 0x00, 0x02, 0x00, 0x01, 0x00]))).toBeNull();
        expect(sniffMime(Buffer.from('#!/bin/sh\necho hi\n'))).toBeNull();
    });
});

describe('faviconHref', () => {
    test('takes the first local icon link and leaves the rest alone', () => {
        expect(faviconHref('<head><link rel="stylesheet" href="a.css"><link rel="icon" href="/logo.svg"></head>')).toBe('/logo.svg');
        expect(faviconHref('<link rel="shortcut icon" href="favicon.ico">')).toBe('favicon.ico');
        expect(faviconHref('<link rel="icon" href="data:image/png;base64,AAA">')).toBeNull();
        expect(faviconHref('<link rel="icon" href="https://cdn.example.com/logo.png">')).toBeNull();
        expect(faviconHref('<link rel="apple-touch-startup-image" href="x.png">')).toBeNull();
    });
});

describe('deriveIdentity', () => {
    test('walks the candidates in order, ours first', async () => {
        await put('assets/logo.png', PNG);
        expect((await deriveIdentity(folder)).icon?.from).toBe('assets/logo.png');

        await put('.vscode/icon.png', PNG);
        expect((await deriveIdentity(folder)).icon?.from).toBe('.vscode/icon.png');

        await put('.idea/icon.svg', SVG);
        expect((await deriveIdentity(folder)).icon?.from).toBe('.idea/icon.svg');

        await put('.ruimte/icon.png', PNG);
        const derived = await deriveIdentity(folder);
        expect(derived.icon).toMatchObject({ from: '.ruimte/icon.png', mime: 'image/png', darkPath: null });
        expect(derived.icon?.version).toMatch(/^\d+-\d+$/);
    });

    test('picks up the dark variant next to the file', async () => {
        await put('.idea/icon.svg', SVG);
        await put('.idea/icon_dark.svg', SVG);
        const derived = await deriveIdentity(folder);
        // The path is the real one, so on macOS it carries the `/private` prefix of the temp dir.
        expect(derived.icon?.darkPath).toEndWith(join('repo', '.idea', 'icon_dark.svg'));
        expect(derived.icon?.darkMime).toBe('image/svg+xml');
        // Both files decide the cache key, or a change to the dark one would go unnoticed.
        expect(derived.icon?.version).toContain('.');
    });

    test('skips a file that is empty, too large or not an image', async () => {
        await put('favicon.svg', '');
        await put('favicon.ico', 'not an icon at all');
        await put('favicon.png', Buffer.alloc(ICON_MAX_BYTES + 1));
        await put('public/favicon.png', PNG);
        expect((await deriveIdentity(folder)).icon?.from).toBe('public/favicon.png');
    });

    test('refuses a candidate that is a symlink out of the folder', async () => {
        await writeFile(join(outside, 'secret.png'), PNG);
        await mkdir(join(folder, '.idea'), { recursive: true });
        await symlink(join(outside, 'secret.png'), join(folder, '.idea', 'icon.png'));
        expect((await deriveIdentity(folder)).icon).toBeNull();
    });

    test('falls back to the icon link in the root index.html, under public first', async () => {
        await put('index.html', '<html><head><link rel="icon" href="/brand.svg" /></head></html>');
        await put('brand.svg', SVG);
        expect((await deriveIdentity(folder)).icon?.from).toBe('brand.svg');

        await put('public/brand.svg', SVG);
        expect((await deriveIdentity(folder)).icon?.from).toBe('public/brand.svg');
    });

    test('reads the name from .idea/.name and cleans it up', async () => {
        await put('.idea/.name', '\n\n  Ruimte Canvas \t\n second line\n');
        expect((await deriveIdentity(folder)).name).toBe('Ruimte Canvas');

        await put('.idea/.name', `${'x'.repeat(200)}\n`);
        expect((await deriveIdentity(folder)).name).toHaveLength(64);

        await put('.idea/.name', Buffer.alloc(8 * 1024, 0x41));
        expect((await deriveIdentity(folder)).name).toBeNull();
    });

    test('a folder that cannot be read is unresolved, which is not the same as empty', async () => {
        const derived = await deriveIdentity(join(root, 'gone'));
        expect(derived).toEqual({ icon: null, name: null, unresolved: true });
    });
});

describe('IdentityCache', () => {
    test('answers from memory until the window passes', async () => {
        let now = 1000;
        const cache = new IdentityCache(5000, () => now);
        await put('.ruimte/icon.png', PNG);
        expect((await cache.resolve(folder)).icon?.from).toBe('.ruimte/icon.png');

        await rm(join(folder, '.ruimte', 'icon.png'));
        expect((await cache.resolve(folder)).icon?.from).toBe('.ruimte/icon.png');

        now += 5001;
        expect((await cache.resolve(folder)).icon).toBeNull();
    });

    test('invalidate makes the next answer come from disk again', async () => {
        const cache = new IdentityCache();
        expect((await cache.resolve(folder)).icon).toBeNull();
        await put('.ruimte/icon.svg', SVG);
        expect((await cache.resolve(folder)).icon).toBeNull();
        cache.invalidate(folder);
        expect((await cache.resolve(folder)).icon?.from).toBe('.ruimte/icon.svg');
    });

    test('a folder it could not look into is asked again', async () => {
        const gone = join(root, 'gone');
        const cache = new IdentityCache();
        expect((await cache.resolve(gone)).unresolved).toBe(true);
        await mkdir(gone);
        await writeFile(join(gone, 'favicon.png'), PNG);
        expect((await cache.resolve(gone)).icon?.from).toBe('favicon.png');
    });
});
