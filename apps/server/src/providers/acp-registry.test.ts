import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AcpRegistry, readRegistry, registryKind, registryPlatform, type RegistryFetch } from './acp-registry.ts';

const SHA = 'a'.repeat(64);

function binary(cmd: string, extra: Record<string, unknown> = {}) {
    return { archive: 'https://example.test/agent.tar.gz', cmd, ...extra };
}

const DOCUMENT = {
    version: '1.0.0',
    agents: [
        {
            id: 'goose',
            name: 'goose',
            version: '1.55.0',
            description: 'An open source agent',
            distribution: {
                binary: { 'darwin-aarch64': binary('./goose', { args: ['acp'], sha256: SHA }), 'linux-x86_64': binary('./goose', { args: ['acp'] }) }
            }
        },
        { id: 'kilo', name: 'Kilo', version: '7.8.15', distribution: { npx: { package: '@kilocode/cli@7.8.15', args: ['acp'] } } },
        {
            id: 'fast-agent',
            name: 'fast-agent',
            version: '0.10.1',
            distribution: { uvx: { package: 'fast-agent-acp==0.10.1', env: { FAST_AGENT_MODEL: 'x' } } }
        },
        { id: 'grok-build', name: 'Grok', version: '1.0.67', distribution: { npx: { package: '@xai-official/grok@1.0.67' } } },
        { id: 'gemini', name: 'Gemini CLI', version: '0.65.0', distribution: { npx: { package: '@google/gemini-cli@0.65.0' } } },
        { id: 'Upper', name: 'Not a kind', version: '1', distribution: { npx: { package: 'upper@1' } } },
        { id: 'windows-only', name: 'Elsewhere', version: '1', distribution: { binary: { 'windows-x86_64': binary('./w.exe') } } },
        { id: 'flagged', name: 'Flag', version: '1', distribution: { npx: { package: '--registry=https://elsewhere.test' } } },
        { id: 'broken', name: 'Broken' }
    ]
};

describe('registryPlatform', () => {
    test('names a system the way the registry does', () => {
        expect(registryPlatform('darwin', 'arm64')).toBe('darwin-aarch64');
        expect(registryPlatform('linux', 'x64')).toBe('linux-x86_64');
        expect(registryPlatform('win32', 'x64')).toBe('windows-x86_64');
        expect(registryPlatform('freebsd', 'x64')).toBeNull();
    });
});

describe('registryKind', () => {
    test('is the id, unless the daemon knows that kind itself', () => {
        expect(registryKind('goose')).toBe('goose');
        expect(registryKind('antigravity-acp')).toBeNull();
        expect(registryKind('gemini')).toBeNull();
        expect(registryKind('claude')).toBeNull();
        expect(registryKind('Upper')).toBeNull();
    });
});

describe('readRegistry', () => {
    test('keeps what this machine can run, a build before a package', () => {
        const entries = readRegistry(DOCUMENT, 'darwin-aarch64');
        expect(entries.map((entry) => entry.id)).toEqual(['goose', 'kilo', 'fast-agent']);
        expect(entries[0]!.distribution).toEqual({
            type: 'binary',
            url: 'https://example.test/agent.tar.gz',
            cmd: './goose',
            args: ['acp'],
            env: {},
            sha256: SHA
        });
        expect(entries[1]!.distribution).toEqual({ type: 'npm', package: '@kilocode/cli@7.8.15', args: ['acp'], env: {} });
        expect(entries[2]!.distribution).toEqual({ type: 'uv', package: 'fast-agent-acp==0.10.1', args: [], env: { FAST_AGENT_MODEL: 'x' } });
    });

    test('a build without a checksum is still offered, and one for another system is not', () => {
        const entries = readRegistry(DOCUMENT, 'linux-x86_64');
        expect(entries[0]!.distribution).toMatchObject({ type: 'binary', sha256: null });
        expect(entries.map((entry) => entry.id)).not.toContain('windows-only');
    });

    test('refuses a document that is no registry', () => {
        expect(() => readRegistry({ nope: true }, 'linux-x86_64')).toThrow('unreadable');
    });
});

describe('AcpRegistry', () => {
    let home: string;
    let now: number;
    let answers: (() => unknown)[];
    let asked: number;

    beforeEach(async () => {
        home = await mkdtemp(join(tmpdir(), 'ruimte-acp-registry-'));
        now = 1_000_000;
        answers = [];
        asked = 0;
    });

    afterEach(async () => {
        await rm(home, { recursive: true, force: true });
    });

    const fetching: RegistryFetch = async () => {
        asked++;
        const next = answers.shift();
        if (next === undefined) {
            throw new Error('offline');
        }
        return next();
    };

    const registry = () => new AcpRegistry({ home, fetch: fetching, now: () => now, platform: 'darwin', arch: 'arm64' });

    test('reads the registry once an hour unless a person refreshes', async () => {
        answers.push(
            () => DOCUMENT,
            () => DOCUMENT
        );
        const catalog = registry();
        expect((await catalog.read()).source).toBe('live');
        now += 30 * 60_000;
        await catalog.read();
        expect(asked).toBe(1);
        await catalog.read(true);
        expect(asked).toBe(2);
    });

    test('falls back to the last good catalog on disk, and says why', async () => {
        answers.push(() => DOCUMENT);
        await registry().read();
        const later = registry();
        const read = await later.read();
        expect(read.source).toBe('cached');
        expect(read.error).toBe('offline');
        expect(read.fetchedAt).toBe(1_000_000);
        expect(read.entries.map((entry) => entry.id)).toEqual(['goose', 'kilo', 'fast-agent']);
        expect(later.known('kilo')?.name).toBe('Kilo');
    });

    test('has nothing to show the first time the registry cannot be reached', async () => {
        const read = await registry().read();
        expect(read).toMatchObject({ source: 'unavailable', fetchedAt: null, error: 'offline', entries: [] });
    });
});
