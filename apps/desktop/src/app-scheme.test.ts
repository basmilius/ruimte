import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DESKTOP_APP_ORIGIN, VISUAL_HOST_PAGE } from '@ruimte/contracts';
import { VISUAL_HOST_CSP, VISUAL_HOST_PATH } from '@ruimte/csp';
import { answerAppRequest, createDesktopAppScheme, STORAGE_MOVE_PATH } from './app-scheme';

let root: string;
let scheme: ReturnType<typeof createDesktopAppScheme>;

beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'ruimte-app-scheme-'));
    await mkdir(join(root, 'assets'));
    await writeFile(join(root, 'index.html'), '<!doctype html><title>Ruimte</title>');
    await writeFile(join(root, 'assets', 'app.js'), 'export {};');
    await writeFile(join(root, 'assets', 'shiki.wasm'), new Uint8Array([0, 97, 115, 109]));
    scheme = createDesktopAppScheme(root);
});

afterEach(async () => {
    await rm(root, { recursive: true, force: true });
});

async function request(url: string): Promise<Response> {
    return answerAppRequest(scheme, new Request(url));
}

describe('the shared app scheme in Ruimte', () => {
    test('serves the page at the root and at routes without an extension', async () => {
        for (const path of ['/', '/?window=a&view=b', '/projects/abc']) {
            const response = await request(`${DESKTOP_APP_ORIGIN}${path}`);
            expect(response.status).toBe(200);
            expect(await response.text()).toContain('<title>Ruimte</title>');
            expect(response.headers.get('content-type')).toBe('text/html; charset=utf-8');
            expect(response.headers.get('content-security-policy')).toContain("default-src 'self'");
        }
    });

    test('serves chunks and WebAssembly with their type and the client policy', async () => {
        const script = await request(`${DESKTOP_APP_ORIGIN}/assets/app.js`);
        expect(await script.text()).toBe('export {};');
        expect(script.headers.get('content-type')).toBe('text/javascript; charset=utf-8');
        expect(script.headers.get('content-security-policy')).toContain("default-src 'self'");
        const wasm = await request(`${DESKTOP_APP_ORIGIN}/assets/shiki.wasm`);
        expect(wasm.headers.get('content-type')).toBe('application/wasm');
        expect(new Uint8Array(await wasm.arrayBuffer())).toEqual(new Uint8Array([0, 97, 115, 109]));
    });

    test('refuses missing chunks, other origins and malformed paths', async () => {
        for (const url of [
            `${DESKTOP_APP_ORIGIN}/assets/gone-1234.js`,
            'app://elsewhere/',
            'https://ruimte/assets/app.js',
            `${DESKTOP_APP_ORIGIN}/%E0%A4%A`,
            `${DESKTOP_APP_ORIGIN}/%2e%2e%2fsecrets.txt`
        ]) {
            expect((await request(url)).status).toBe(404);
        }
    });

    test('does not serve a symlink that leaves the client build', async () => {
        const outside = await mkdtemp(join(tmpdir(), 'ruimte-app-outside-'));
        try {
            await writeFile(join(outside, 'private.txt'), 'private');
            await symlink(join(outside, 'private.txt'), join(root, 'assets', 'private.txt'));
            expect((await request(`${DESKTOP_APP_ORIGIN}/assets/private.txt`)).status).toBe(404);
        } finally {
            await rm(outside, { recursive: true, force: true });
        }
    });

    test('keeps the storage move on a blank page without booting the client', async () => {
        const blank = await request(`${DESKTOP_APP_ORIGIN}${STORAGE_MOVE_PATH}`);
        expect(await blank.text()).toBe('<!doctype html><title>Ruimte</title>');
        expect(blank.headers.get('content-security-policy')).toBeNull();
        expect((await request(`app://elsewhere${STORAGE_MOVE_PATH}`)).status).toBe(404);
    });

    test('answers the host page of a visual under its own policy, never the client', async () => {
        const host = await request(`${DESKTOP_APP_ORIGIN}${VISUAL_HOST_PATH}`);
        expect(host.status).toBe(200);
        expect(await host.text()).toBe(VISUAL_HOST_PAGE);
        expect(host.headers.get('content-type')).toBe('text/html; charset=utf-8');
        expect(host.headers.get('content-security-policy')).toBe(VISUAL_HOST_CSP);
        expect(host.headers.get('x-content-type-options')).toBe('nosniff');
        expect(host.headers.get('cache-control')).toBe('no-cache');
        expect(host.headers.get('x-frame-options')).toBeNull();
        expect((await request(`app://elsewhere${VISUAL_HOST_PATH}`)).status).toBe(404);
        const beside = await request(`${DESKTOP_APP_ORIGIN}/__visual/other`);
        expect(await beside.text()).toContain('<title>Ruimte</title>');
        expect(beside.headers.get('content-security-policy')).toContain("default-src 'self'");
    });

    test('binds packaged navigation and IPC to the registered app origin', () => {
        expect(scheme.url).toBe(`${DESKTOP_APP_ORIGIN}/`);
        expect(scheme.origin).toBe(DESKTOP_APP_ORIGIN);
        expect(scheme.privileged.privileges).toEqual({
            standard: true,
            secure: true,
            supportFetchAPI: true,
            corsEnabled: true,
            stream: true,
            codeCache: true,
            allowServiceWorkers: true
        });
        expect(scheme.navigation(`${DESKTOP_APP_ORIGIN}/projects/a`)).toBe('allow');
        expect(scheme.navigation('https://example.com/')).toBe('external');
        expect(scheme.navigation('file:///etc/hosts')).toBe('refuse');
        expect(scheme.isAppSender(true, { url: scheme.url, parent: null })).toBe(true);
        expect(scheme.isAppSender(false, { url: scheme.url, parent: null })).toBe(false);
        expect(scheme.isAppSender(true, { url: scheme.url, parent: {} })).toBe(false);
        expect(scheme.isAppSender(true, { url: 'app://elsewhere/', parent: null })).toBe(false);
    });

    test('uses the dev origin for guards while still serving the storage migration', async () => {
        scheme = createDesktopAppScheme(root, 'http://localhost:4212');
        expect(scheme.url).toBe('http://localhost:4212');
        expect(scheme.origin).toBe('http://localhost:4212');
        expect(scheme.isAppUrl('http://localhost:4212/projects/a')).toBe(true);
        expect(scheme.isAppUrl(`${DESKTOP_APP_ORIGIN}/`)).toBe(false);
        expect(scheme.isAppSender(true, { url: scheme.url, parent: null })).toBe(true);
        expect(scheme.isAppSender(true, { url: `${DESKTOP_APP_ORIGIN}/`, parent: null })).toBe(false);
        expect(scheme.navigation('http://localhost:4212/projects/a')).toBe('allow');
        expect(scheme.navigation(`${DESKTOP_APP_ORIGIN}/`)).toBe('refuse');
        expect(await (await request(`${DESKTOP_APP_ORIGIN}${STORAGE_MOVE_PATH}`)).text()).toBe('<!doctype html><title>Ruimte</title>');
    });
});
