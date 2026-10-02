import { afterEach, beforeEach, expect, test } from 'bun:test';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { serveClient } from './serve-client.ts';

let dir: string;

beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'ruimte-serve-client-'));
    await mkdir(join(dir, 'assets'));
    await writeFile(join(dir, 'index.html'), '<!doctype html><title>Ruimte</title>');
    await writeFile(join(dir, 'assets', 'app.js'), 'export {};');
});

afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
});

test('serves a file of the build under the client policy', async () => {
    const response = await serveClient(dir, '/assets/app.js');
    expect(await response.text()).toBe('export {};');
    expect(response.headers.get('content-security-policy')).toContain("default-src 'self'");
});

test('answers a page address the build has no file for with the app shell', async () => {
    expect(await (await serveClient(dir, '/projects/abc')).text()).toContain('<title>Ruimte</title>');
    expect(await (await serveClient(dir, '/')).text()).toContain('<title>Ruimte</title>');
});

test('never leaves the build folder', async () => {
    expect(await (await serveClient(dir, '/../../etc/hosts')).text()).toContain('<title>Ruimte</title>');
});
