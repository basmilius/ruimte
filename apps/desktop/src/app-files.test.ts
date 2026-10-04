import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { answerAppRequest, clientFileFor, STORAGE_MOVE_PATH } from './app-files';

let root: string;

beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'ruimte-app-files-'));
    await mkdir(join(root, 'assets'));
    await writeFile(join(root, 'index.html'), '<!doctype html><title>Ruimte</title>');
    await writeFile(join(root, 'assets', 'app.js'), 'export {};');
    await writeFile(join(root, 'assets', 'shiki.wasm'), new Uint8Array([0, 97, 115, 109]));
});

afterEach(async () => {
    await rm(root, { recursive: true, force: true });
});

describe('the files of the app scheme', () => {
    test('an address without an extension is the page, a file is the file, and nothing leaves the build', () => {
        expect(clientFileFor(root, 'app://ruimte/')).toBe(join(root, 'index.html'));
        expect(clientFileFor(root, 'app://ruimte/?window=a&view=b')).toBe(join(root, 'index.html'));
        expect(clientFileFor(root, 'app://ruimte/projects/abc')).toBe(join(root, 'index.html'));
        expect(clientFileFor(root, 'app://ruimte/assets/app.js')).toBe(join(root, 'assets', 'app.js'));
        expect(clientFileFor(root, 'app://ruimte/../../etc/hosts.txt')).toBe(join(root, 'etc', 'hosts.txt'));
        expect(clientFileFor(root, 'app://ruimte/%2e%2e/%2e%2e/etc/hosts.txt')).toBe(join(root, 'etc', 'hosts.txt'));
        expect(clientFileFor(root, 'app://elsewhere/assets/app.js')).toBeNull();
        expect(clientFileFor(root, 'app://ruimte/%E0%A4%A')).toBeNull();
    });

    test('a file of the build comes with its type and the client policy', async () => {
        const script = await answerAppRequest(root, 'app://ruimte/assets/app.js');
        expect(await script.text()).toBe('export {};');
        expect(script.headers.get('content-type')).toBe('text/javascript; charset=utf-8');
        expect(script.headers.get('content-security-policy')).toContain("default-src 'self'");
        expect((await answerAppRequest(root, 'app://ruimte/assets/shiki.wasm')).headers.get('content-type')).toBe('application/wasm');
        const page = await answerAppRequest(root, 'app://ruimte/projects/abc');
        expect(await page.text()).toContain('<title>Ruimte</title>');
        expect(page.headers.get('content-type')).toBe('text/html; charset=utf-8');
    });

    test('a chunk the build does not have is a 404, so a stale one fails as a load error and not as the page', async () => {
        expect((await answerAppRequest(root, 'app://ruimte/assets/gone-1234.js')).status).toBe(404);
        expect((await answerAppRequest(root, 'app://elsewhere/')).status).toBe(404);
    });

    test('the page the storage move writes from is blank, so it never boots the client', async () => {
        const blank = await answerAppRequest(root, `app://ruimte${STORAGE_MOVE_PATH}`);
        expect(await blank.text()).toBe('<!doctype html><title>Ruimte</title>');
        expect(blank.headers.get('content-security-policy')).toBeNull();
    });
});
