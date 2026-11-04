import { afterAll, beforeAll, expect, test } from 'bun:test';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { integrationFiles } from './test-integration.ts';

let root: string;
beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), 'ruimte-test-discovery-'));
    for (const path of [
        'apps/client/current.integration.test.ts',
        'apps/client/current.browser.integration.test.ts',
        'apps/server/current.integration.test.ts',
        'apps/server/current.device.integration.test.ts',
        'packages/npm/current.package.integration.test.ts',
        'packages/contracts/current.integration.test.ts',
        'scripts/current.integration.test.ts',
        'extensions/limits/server/current.integration.test.ts',
        'extensions/poc/board/current.integration.test.ts',
        'extensions/limits/test/host.integration.test.ts',
        'extensions/poc/board/test/host.integration.test.ts',
        'extensions/limits/node_modules/library/foreign.integration.test.ts',
        'docs/reports/old.integration.test.ts',
        'docs/reports/old.browser.integration.test.ts',
        'apps/client/node_modules/library/foreign.integration.test.ts',
        'apps/client/node_modules/library/foreign.device.integration.test.ts',
        'packages/npm/node_modules/library/foreign.package.integration.test.ts',
        'packages/contracts/node_modules/library/foreign.browser.integration.test.ts'
    ]) {
        const target = join(root, path);
        await mkdir(dirname(target), { recursive: true });
        await writeFile(target, 'throw new Error("Must not be loaded during discovery");');
    }
});
afterAll(async () => {
    await rm(root, { recursive: true, force: true });
});

test('default integration discovery selects automatic workspace tests without loading archives, dependencies, browsers or devices', () => {
    expect(integrationFiles(root)).toEqual([
        './apps/client/current.integration.test.ts',
        './apps/server/current.integration.test.ts',
        './extensions/limits/server/current.integration.test.ts',
        './extensions/poc/board/current.integration.test.ts',
        './packages/contracts/current.integration.test.ts',
        './packages/npm/current.package.integration.test.ts',
        './scripts/current.integration.test.ts'
    ]);
});

test("an extension's own integration test is found, its test folder left to the extension host", () => {
    const found = integrationFiles(root, 'core');
    expect(found).toContain('./extensions/limits/server/current.integration.test.ts');
    expect(found.filter((path) => path.includes('/test/') || path.includes('node_modules'))).toEqual([]);
});

test('browser discovery selects only active browser tests', () => {
    expect(integrationFiles(root, 'browser')).toEqual(['./apps/client/current.browser.integration.test.ts']);
});

test('core and package jobs together cover every automatic integration file exactly once', () => {
    const core = integrationFiles(root, 'core');
    const packaged = integrationFiles(root, 'package');
    expect(packaged).toEqual(['./packages/npm/current.package.integration.test.ts']);
    expect(core).not.toContain(packaged[0]!);
    expect([...core, ...packaged].sort()).toEqual(integrationFiles(root));
});

test('device discovery selects only tests that need a running simulator or device', () => {
    expect(integrationFiles(root, 'devices')).toEqual(['./apps/server/current.device.integration.test.ts']);
});
