import { beforeEach, describe, expect, test } from 'bun:test';
import { existsSync } from 'node:fs';
import { mkdir, readdir, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { AgentKind } from '@ruimte/contracts';
import type { ChatProvider } from '@adecore/agents/providers';
import { isMachineStatePath } from '../fs/machine-home.ts';
import { sha256, tarGz, zip } from '../language/test-archives.ts';
import { AcpRegistry } from './acp-registry.ts';
import { tempHomes } from '../temp-home-test-helpers.ts';
import { RegistryAgents, npmBin, packageName, relativeCommand, type InstallRun } from './registry-agents.ts';

const ZIP = zip([{ path: 'bin/agent', text: '#!/bin/sh\n', mode: 0o644 }]);
const TAR = tarGz([{ path: 'goose', text: '#!/bin/sh\n', mode: 0o755 }]);

function documentWith(agents: unknown[]) {
    return { version: '1.0.0', agents };
}

const ZIPPED = (sha: string | undefined) => ({
    id: 'zipped',
    name: 'Zipped',
    version: '2.0.0',
    description: 'In a zip',
    distribution: {
        binary: {
            'linux-x86_64': {
                archive: 'https://example.test/agent.zip',
                cmd: './bin/agent',
                args: ['acp'],
                env: { NO_UPDATE: '1' },
                ...(sha ? { sha256: sha } : {})
            }
        }
    }
});

const TARRED = {
    id: 'tarred',
    name: 'Tarred',
    version: '1.0.0',
    distribution: { binary: { 'linux-x86_64': { archive: 'https://example.test/goose.tar.gz', cmd: './goose' } } }
};

const NPM = { id: 'kilo', name: 'Kilo', version: '7.8.15', distribution: { npx: { package: '@kilocode/cli@7.8.15', args: ['acp'] } } };

const newHome = tempHomes('ruimte-registry-agents-');
let home: string;
let document: unknown;
let downloads: Record<string, Uint8Array>;
let ran: string[][];
let offered: Map<AgentKind, ChatProvider>;

beforeEach(async () => {
    home = await newHome();
    document = documentWith([ZIPPED(sha256(ZIP)), TARRED, NPM]);
    downloads = { 'https://example.test/agent.zip': ZIP, 'https://example.test/goose.tar.gz': TAR };
    ran = [];
    offered = new Map();
});

const npmInstall: InstallRun = async (command) => {
    ran.push(command);
    const prefix = command[command.indexOf('--prefix') + 1]!;
    const folder = join(prefix, 'node_modules', '@kilocode', 'cli');
    await mkdir(join(prefix, 'node_modules', '.bin'), { recursive: true });
    await mkdir(folder, { recursive: true });
    await writeFile(join(folder, 'package.json'), JSON.stringify({ name: '@kilocode/cli', bin: { kilo: 'bin/kilo' } }));
    await writeFile(join(prefix, 'node_modules', '.bin', 'kilo'), '#!/bin/sh\n');
    return { exitCode: 0, stdout: '', stderr: '' };
};

function agents(options: { which?: (command: string) => string | null; run?: InstallRun } = {}): RegistryAgents {
    const registry = new AcpRegistry({ home, fetch: async () => document, platform: 'linux', arch: 'x64' });
    return new RegistryAgents({
        home,
        registry,
        providers: {
            add: (provider) => offered.set(provider.kind, provider),
            remove: (kind) => offered.delete(kind),
            invalidate: () => undefined
        },
        download: async (url, destination) => {
            const bytes = downloads[url];
            if (bytes === undefined) {
                throw new Error(`${url} answered 404`);
            }
            await writeFile(destination, bytes);
        },
        run: options.run ?? npmInstall,
        which: options.which ?? ((command) => `/usr/bin/${command}`),
        platform: 'linux'
    });
}

describe('RegistryAgents', () => {
    test('lists the catalog with where each agent stands, and installs nothing by itself', async () => {
        const catalog = await agents().catalog();
        expect(catalog.agents.map((agent) => [agent.id, agent.distribution, agent.checksum, agent.state])).toEqual([
            ['zipped', 'binary', true, 'missing'],
            ['tarred', 'binary', false, 'missing'],
            ['kilo', 'npm', false, 'missing']
        ]);
        expect(existsSync(join(home, 'agent-registry', 'agents'))).toBe(false);
    });

    test('a verified download is unpacked, offered as a chat and started from the machine state', async () => {
        const installs = agents();
        await installs.catalog();
        const agent = await installs.install('zipped');
        expect(agent).toMatchObject({ state: 'installed', installed: '2.0.0' });
        const provider = offered.get('zipped')!;
        const program = join(home, 'agent-registry', 'agents', 'zipped', '2.0.0', 'bin', 'agent');
        expect(provider.command).toEqual([program, 'acp']);
        expect(provider.capabilities.chat).toBe(true);
        expect(provider.capabilities.terminal).toBe(false);
        // Windows has no execute bit to set.
        if (process.platform !== 'win32') {
            expect(((await stat(program)).mode & 0o111) !== 0).toBe(true);
        }
        expect(await provider.detect(program, {})).toEqual({ installed: true, version: '2.0.0' });
        expect(isMachineStatePath({ homes: [home] }, program)).toBe(true);
    });

    test('a download that does not match its checksum is never unpacked', async () => {
        document = documentWith([ZIPPED('b'.repeat(64))]);
        const installs = agents();
        await installs.catalog();
        const agent = await installs.install('zipped');
        expect(agent.state).toBe('failed');
        expect(agent.error).toContain('The download is damaged');
        expect(offered.size).toBe(0);
        expect(await readdir(join(home, 'agent-registry', 'agents', 'zipped'))).toEqual([]);
    });

    test('unpacks a tarball the registry gives no checksum for', async () => {
        const installs = agents();
        await installs.catalog();
        expect(await installs.install('tarred')).toMatchObject({ state: 'installed', checksum: false });
        expect(offered.get('tarred')?.command).toEqual([join(home, 'agent-registry', 'agents', 'tarred', '1.0.0', 'goose')]);
    });

    test('installs an npm package into its own folder and starts the program it names', async () => {
        const installs = agents();
        await installs.catalog();
        expect((await installs.install('kilo')).state).toBe('installed');
        const target = join(home, 'agent-registry', 'agents', 'kilo', '7.8.15');
        expect(ran).toEqual([['/usr/bin/npm', 'install', '--prefix', target, '--no-audit', '--no-fund', '@kilocode/cli@7.8.15']]);
        expect(offered.get('kilo')?.command).toEqual([join(target, 'node_modules', '.bin', 'kilo'), 'acp']);
    });

    test('says what is missing when the machine has no npm', async () => {
        const installs = agents({ which: () => null });
        await installs.catalog();
        const agent = await installs.install('kilo');
        expect(agent.state).toBe('failed');
        expect(agent.error).toContain('npm, which comes with Node.js');
    });

    test('a newer version in the registry installs in place of the old one', async () => {
        const installs = agents();
        await installs.catalog();
        await installs.install('zipped');
        document = documentWith([{ ...ZIPPED(sha256(ZIP)), version: '2.1.0' }]);
        await installs.catalog(true);
        expect((await installs.install('zipped')).installed).toBe('2.1.0');
        expect((await readdir(join(home, 'agent-registry', 'agents', 'zipped'))).sort()).toEqual(['2.1.0', 'installed.json']);
    });

    test('offers what was installed before a restart, and removes it again', async () => {
        const first = agents();
        await first.catalog();
        await first.install('zipped');
        offered.clear();
        const second = agents();
        second.load();
        expect([...offered.keys()]).toEqual(['zipped']);
        expect((await second.remove('zipped')).state).toBe('missing');
        expect(offered.size).toBe(0);
        expect(existsSync(join(home, 'agent-registry', 'agents', 'zipped'))).toBe(false);
    });

    test('an installed agent the registry dropped stays listed', async () => {
        const installs = agents();
        await installs.catalog();
        await installs.install('zipped');
        document = documentWith([NPM]);
        const catalog = await installs.catalog(true);
        expect(catalog.agents.map((agent) => [agent.id, agent.state])).toEqual([
            ['kilo', 'missing'],
            ['zipped', 'installed']
        ]);
    });
});

describe('the names a registry entry is installed by', () => {
    test('a command stays inside the agent folder', () => {
        expect(relativeCommand('./goose')).toBe('goose');
        expect(relativeCommand('./goose-package\\goose.exe')).toBe('goose-package/goose.exe');
        expect(relativeCommand('../escape')).toBeNull();
        expect(relativeCommand('/bin/sh')).toBeNull();
    });

    test('a package loses the version it is pinned to', () => {
        expect(packageName('@kilocode/cli@7.8.15', 'npm')).toBe('@kilocode/cli');
        expect(packageName('cline@3.0.73', 'npm')).toBe('cline');
        expect(packageName('fast-agent-acp==0.10.1', 'uv')).toBe('fast-agent-acp');
        expect(packageName('minion-code@0.1.44', 'uv')).toBe('minion-code');
    });

    test('npm starts the only program of a package, or the one named like it', () => {
        expect(npmBin('@kilocode/cli', 'bin/kilo.js')).toBe('cli');
        expect(npmBin('@kilocode/cli', { kilo: 'bin/kilo' })).toBe('kilo');
        expect(npmBin('droid', { droid: 'a', helper: 'b' })).toBe('droid');
        expect(npmBin('droid', { one: 'a', two: 'b' })).toBeNull();
    });
});
