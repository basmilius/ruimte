import { afterAll, afterEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ExtensionHost } from './extension-host.ts';
import { packExtension } from './pack.ts';
import { ExtensionStore } from './store.ts';

const EXTENSIONS = join(import.meta.dir, '../../../../extensions');
const POCS = ['surfaces', 'workspace', 'server', 'agents', 'frame', 'themes', 'broken', 'broken-load'];
const root = mkdtempSync(join(tmpdir(), 'ruimte-extension-poc-'));
const hosts: ExtensionHost[] = [];

function hostIn(name: string): { host: ExtensionHost; home: string } {
    const home = join(root, name);
    const host = new ExtensionHost({ store: new ExtensionStore(home) });

    hosts.push(host);

    return { host, home };
}

async function packOf(name: string): Promise<string> {
    const { path } = await packExtension(join(EXTENSIONS, `poc-${name}`));

    return readFileSync(path).toString('base64');
}

async function until(condition: () => boolean): Promise<void> {
    for (let attempt = 0; attempt < 200 && !condition(); attempt++) {
        await Bun.sleep(10);
    }
}

afterEach(() => hosts.splice(0).forEach((host) => host.stopAll()));
afterAll(() => {
    rmSync(root, { recursive: true, force: true });

    for (const name of POCS) {
        rmSync(join(EXTENSIONS, `poc-${name}`, 'dist'), { recursive: true, force: true });
    }
});

describe('the proof-of-concept extensions', () => {
    test.each(POCS)('poc-%s packs and installs', async (name) => {
        const { host } = hostIn(`install-${name}`);
        const info = await host.install(await packOf(name));

        expect(info.manifest.id).toBe(`poc.${name}`);
    });

    test('poc-server keeps storage and secrets over a restart, and its secrets are private', async () => {
        const { host, home } = hostIn('server');

        await host.install(await packOf('server'));

        expect(await host.call('poc.server', 'ping', [])).toBe('pong');
        expect(await host.call('poc.server', 'count', [])).toBe(1);
        expect(await host.call('poc.server', 'remember', ['value'])).toBe(true);

        await expect(host.call('poc.server', 'crash', [])).rejects.toThrow('The extension stopped');

        expect(await host.call('poc.server', 'count', [])).toBe(2);
        expect(statSync(join(new ExtensionStore(home).dataFolder('poc.server'), 'secrets.json')).mode & 0o077).toBe(0);
    });

    test('poc-server says something to clients, hears machine events and reads its node for an agent', async () => {
        const { host } = hostIn('events');
        const heard: unknown[] = [];

        host.subscribe('client', (event) => heard.push(event));
        await host.install(await packOf('server'));
        await host.call('poc.server', 'tick', []);

        expect(JSON.stringify(heard)).toContain('tick');

        host.forwardEvent('chat.status', {});

        // The event goes down the same pipe ahead of this call, so it has been handled by the answer.
        expect(await host.call('poc.server', 'eventsSeen', [])).toBe(1);
        expect(await host.nodeContext('poc.server', 'fact', { fact: 'The answer is 42' })).toEqual([{ text: 'The answer is 42' }]);
    });

    test('poc-server asks the machine, within its permissions and at most 20 sends an hour', async () => {
        const home = join(root, 'asks');
        const sent: string[] = [];
        const host = new ExtensionHost({
            store: new ExtensionStore(home),
            asks: () => ({
                'agents.run': async () => ({ text: 'answered' }),
                'chats.list': async () => [{}, {}],
                'chats.send': async (chatId: string) => void sent.push(chatId)
            })
        });

        hosts.push(host);
        await host.install(await packOf('server'));

        expect(await host.call('poc.server', 'ask', ['hi'])).toEqual({ text: 'answered' });
        expect(await host.call('poc.server', 'chatCount', [])).toBe(2);

        for (let count = 0; count < 20; count++) {
            await host.call('poc.server', 'poke', ['chat']);
        }

        await expect(host.call('poc.server', 'poke', ['chat'])).rejects.toThrow('has to wait');
        expect(sent).toHaveLength(20);
    });

    test('poc-server offers an agent a tool, only while it runs', async () => {
        const { host } = hostIn('tools');

        await host.install(await packOf('server'));
        await until(() => host.agentTools().length > 0);

        expect(host.agentTools().map((tool) => tool.id)).toEqual(['poc.server/fact']);
        expect(await host.runAgentTool('poc.server/fact', { about: 'Life' }, { caller: 'chat-1' })).toBe('Life is 42, for chat-1');
        await expect(host.runAgentTool('poc.server/none', {}, { caller: 'chat-1' })).rejects.toThrow('No tool');

        await host.setEnabled('poc.server', false);

        expect(host.agentTools()).toEqual([]);
    });

    test('poc-broken fails at load, and stays off after three tries', async () => {
        const { host } = hostIn('broken');

        await host.install(await packOf('broken'));

        for (let attempt = 0; attempt < 3; attempt++) {
            await expect(host.call('poc.broken', 'anything', [])).rejects.toThrow('The extension stopped');
        }

        expect((await host.list())[0]?.status).toBe('crashed');
    });
});
