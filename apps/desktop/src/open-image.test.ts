import { afterEach, expect, test } from 'bun:test';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openImageCopy } from './open-image';

const IMAGE = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jWZkAAAAASUVORK5CYII=', 'base64');
const folders: string[] = [];
afterEach(async () => {
    await Promise.all(folders.splice(0).map((folder) => rm(folder, { recursive: true, force: true })));
});

test('opens only a temporary image copy with an image extension', async () => {
    const folder = await mkdtemp(join(tmpdir(), 'ruimte-open-image-'));
    folders.push(folder);
    let opened = '';
    await openImageCopy(folder, '../../script.command', IMAGE, 'image/png', async (path) => {
        opened = path;
        return '';
    });
    expect(opened.startsWith(`${folder}/`)).toBe(true);
    expect(opened.endsWith('.png')).toBe(true);
    expect(await readFile(opened)).toEqual(IMAGE);
    for (const mime of ['text/plain', 'image/svg+xml', 'constructor', 'image/jpeg']) {
        await expect(openImageCopy(folder, 'image', IMAGE, mime, async () => '')).rejects.toBeDefined();
    }
    await expect(openImageCopy(folder, 'image', Buffer.from('script'), 'image/png', async () => '')).rejects.toBeDefined();
    expect(await readdir(folder)).toHaveLength(1);
});

test('removes the temporary copy when the system viewer refuses it', async () => {
    const folder = await mkdtemp(join(tmpdir(), 'ruimte-open-image-'));
    folders.push(folder);
    await expect(openImageCopy(folder, 'image.png', IMAGE, 'image/png', async () => 'No viewer')).rejects.toThrow('No viewer');
    expect(await readdir(folder)).toEqual([]);
});
