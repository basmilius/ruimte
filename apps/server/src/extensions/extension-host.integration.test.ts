import { afterAll, afterEach, describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ExtensionHost } from './extension-host.ts';
import { packExtension } from './pack.ts';
import { ExtensionStore } from './store.ts';

const root = mkdtempSync(join(tmpdir(), 'ruimte-extension-host-'));
const hosts: ExtensionHost[] = [];

function hostIn(name: string): ExtensionHost {
    const host = new ExtensionHost({ store: new ExtensionStore(join(root, name)) });

    hosts.push(host);

    return host;
}

async function packOf(name: string, server: string, manifest: object = {}): Promise<string> {
    const folder = join(root, `project-${name}`);

    mkdirSync(join(folder, 'server'), { recursive: true });
    writeFileSync(join(folder, 'manifest.json'), JSON.stringify({ id: 'acme.builds', name: 'Builds', version: '0.1.0', api: 1, ...manifest }));
    writeFileSync(join(folder, 'server', 'index.ts'), server);

    const { path } = await packExtension(folder);

    return readFileSync(path).toString('base64');
}

const SERVER = `
import { defineServer, storage } from '@ruimte/extension/server';

export default defineServer({
    async add(left: number, right: number) { return left + right; },
    async remember(value: string) { await storage.set('value', value); return storage.get('value'); },
    async fail() { throw new Error('On purpose'); },
    async die() { process.exit(1); }
});
`;

afterEach(() => hosts.splice(0).forEach((host) => host.stopAll()));
afterAll(() => rmSync(root, { recursive: true, force: true }));

describe('an extension with a server part', () => {
    test('starts on the first call, answers, and keeps its own storage', async () => {
        const host = hostIn('answers');

        await host.install(await packOf('answers', SERVER));

        expect((await host.list())[0]?.status).toBe('idle');
        expect(await host.call('acme.builds', 'add', [2, 3])).toBe(5);
        expect(await host.call('acme.builds', 'remember', ['kept'])).toBe('kept');
        expect((await host.list())[0]?.status).toBe('running');
    });

    test('hands an error of its own back to the caller, and goes on', async () => {
        const host = hostIn('errors');

        await host.install(await packOf('errors', SERVER));

        await expect(host.call('acme.builds', 'fail', [])).rejects.toThrow('On purpose');
        expect(await host.call('acme.builds', 'add', [1, 1])).toBe(2);
        await expect(host.call('acme.builds', 'missing', [])).rejects.toThrow('No method missing');
    });

    test('stays down after three crashes in a row, until a person turns it on again', async () => {
        const host = hostIn('crashes');

        await host.install(await packOf('crashes', 'process.exit(1);'));

        for (let attempt = 0; attempt < 3; attempt++) {
            await expect(host.call('acme.builds', 'add', [])).rejects.toThrow('The extension stopped');
        }

        expect((await host.list())[0]?.status).toBe('crashed');
        await expect(host.call('acme.builds', 'add', [])).rejects.toThrow('stays off');

        await host.setEnabled('acme.builds', true);

        expect((await host.list())[0]?.status).not.toBe('crashed');
    }, 30_000);

    test('does not run while it is off, and a removal takes it and its data away', async () => {
        const host = hostIn('off');

        await host.install(await packOf('off', SERVER));
        await host.setEnabled('acme.builds', false);

        await expect(host.call('acme.builds', 'add', [1, 2])).rejects.toThrow('turned off');
        expect((await host.list())[0]?.status).toBe('disabled');

        await host.remove('acme.builds');

        expect(await host.list()).toEqual([]);
    });

    test('refuses a pack for another API, and leaves the version in use alone', async () => {
        const host = hostIn('api');

        await host.install(await packOf('api', SERVER));

        await expect(host.install(Buffer.from('nonsense').toString('base64'))).rejects.toThrow('not an extension pack');
        expect((await host.list())[0]?.manifest.version).toBe('0.1.0');
    });

    test('a dev link runs from its folder and reports a new revision on every save', async () => {
        const host = hostIn('link');
        const folder = join(root, 'linked');

        mkdirSync(join(folder, 'server'), { recursive: true });
        writeFileSync(join(folder, 'manifest.json'), JSON.stringify({ id: 'acme.linked', name: 'Linked', version: '0.1.0', api: 1 }));
        writeFileSync(join(folder, 'server', 'index.js'), `export default { async ping() { return 'pong'; } };`);

        await host.linked(folder);

        const first = (await host.list())[0]?.revision;

        expect(await host.call('acme.linked', 'ping', [])).toBe('pong');

        await host.linked(folder);

        expect((await host.list())[0]?.revision).toBe((first ?? 0) + 1);
        expect((await host.list())[0]?.devFolder).toBe(folder);

        await host.appendDevLog('acme.linked', '[client] hello');

        expect(readFileSync(new ExtensionStore(join(root, 'link')).logFile('acme.linked'), 'utf8')).toContain('[client] hello');
    });
});
