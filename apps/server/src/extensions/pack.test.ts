import { afterAll, expect, test } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { EXTENSION_API_VERSION } from '@ruimte/contracts';
import { readManifest } from './pack.ts';

const root = mkdtempSync(join(tmpdir(), 'ruimte-extension-pack-'));

afterAll(() => rmSync(root, { recursive: true, force: true }));

function folderWith(permissions: Record<string, string>): string {
    const folder = mkdtempSync(join(root, 'extension-'));
    writeFileSync(join(folder, 'manifest.json'), JSON.stringify({ id: 'acme.pack', name: 'Pack', version: '0.1.0', api: EXTENSION_API_VERSION, permissions }));

    return folder;
}

test('pack refuses another API version in the words of the manifest, before it builds anything', () => {
    const folder = mkdtempSync(join(root, 'extension-'));
    writeFileSync(join(folder, 'manifest.json'), JSON.stringify({ id: 'acme.pack', name: 'Pack', version: '0.1.0', api: EXTENSION_API_VERSION + 1 }));

    expect(() => readManifest(folder)).toThrow(`manifest.json asks for API ${EXTENSION_API_VERSION + 1}; this Ruimte has ${EXTENSION_API_VERSION}`);
});

test('pack refuses a permission this Ruimte does not know, before it builds anything', () => {
    expect(() => readManifest(folderWith({ 'chat.send': 'Sends' }))).toThrow('manifest.json: chat.send is not a permission this Ruimte knows');
    expect(() => readManifest(folderWith({ 'net:a.com; frame-src https:': 'Calls' }))).toThrow('does not name a host');
});

test('pack takes every permission that opens something', () => {
    expect(readManifest(folderWith({ 'chats.send': 'Sends', 'net:ci.example.com': 'Reads builds' })).permissions).toEqual({
        'chats.send': 'Sends',
        'net:ci.example.com': 'Reads builds'
    });
});
