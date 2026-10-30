import { describe, expect, test } from 'bun:test';
import type { ProviderInfo } from '@ruimte/contracts';
import { CliVersions, classifyInstall, compareVersions, readBrewInfo, type OwnInstall, type VersionRun } from './cli-versions.ts';

const FILES: Record<string, string> = {
    '/opt/homebrew/lib/node_modules/@github/copilot/package.json': JSON.stringify({ version: '1.0.101' }),
    '/Users/me/.bun/install/global/node_modules/@anthropic-ai/claude-code/package.json': JSON.stringify({ version: '2.1.0' }),
    '/Users/me/Library/pnpm/global/5/.pnpm/@openai+codex@0.163.0/node_modules/@openai/codex/package.json': JSON.stringify({ version: '0.163.0' }),
    '/Users/me/Library/pnpm/codex':
        '#!/bin/sh\nexec node "/Users/me/Library/pnpm/global/5/.pnpm/@openai+codex@0.163.0/node_modules/@openai/codex/bin/codex.js" "$@"\n'
};

const readText = (path: string): string | null => FILES[path] ?? null;

describe('classifyInstall', () => {
    test('a Homebrew formula, by its Cellar path, with the revision apart from the version', () => {
        expect(classifyInstall('/opt/homebrew/Cellar/codex/0.160.0_1/bin/codex', readText)).toEqual({
            method: 'homebrew',
            package: 'codex',
            version: '0.160.0',
            prefix: '/opt/homebrew',
            revision: 1
        });
        expect(classifyInstall('/opt/homebrew/Cellar/codex/0.160.0/bin/codex', readText)).toMatchObject({ version: '0.160.0', revision: 0 });
    });

    test('a formula of an npm package is still Homebrew', () => {
        expect(classifyInstall('/opt/homebrew/Cellar/gemini-cli/0.6.0/libexec/lib/node_modules/@google/gemini-cli/dist/index.js', readText).method).toBe(
            'homebrew'
        );
    });

    test('a cask, and one without a version names none', () => {
        expect(classifyInstall('/opt/homebrew/Caskroom/claude-code/2.1.3/claude', readText)).toMatchObject({
            method: 'homebrew-cask',
            package: 'claude-code',
            version: '2.1.3'
        });
        expect(classifyInstall('/opt/homebrew/Caskroom/tool/latest/tool', readText)).toMatchObject({ method: 'homebrew-cask', version: null });
    });

    test('an npm global under the Homebrew prefix is npm, with its version from the package', () => {
        expect(classifyInstall('/opt/homebrew/lib/node_modules/@github/copilot/npm-loader.js', readText)).toEqual({
            method: 'npm',
            package: '@github/copilot',
            version: '1.0.101',
            prefix: '/opt/homebrew'
        });
    });

    test('a Bun global', () => {
        expect(classifyInstall('/Users/me/.bun/install/global/node_modules/@anthropic-ai/claude-code/cli.js', readText)).toMatchObject({
            method: 'bun',
            package: '@anthropic-ai/claude-code',
            version: '2.1.0'
        });
    });

    test('a pnpm shim is read for the package it starts', () => {
        expect(classifyInstall('/Users/me/Library/pnpm/codex', readText)).toMatchObject({ method: 'pnpm', package: '@openai/codex', version: '0.163.0' });
    });

    test('an npm global on Windows, through the shim npm writes', () => {
        const files: Record<string, string> = {
            'C:/Users/me/AppData/Roaming/npm/codex.cmd': '@ECHO off\r\nSET dp0=%~dp0\r\n"%dp0%\\node_modules\\@openai\\codex\\bin\\codex.js" %*\r\n',
            'C:/Users/me/AppData/Roaming/npm/node_modules/@openai/codex/package.json': JSON.stringify({ version: '0.163.0' })
        };
        expect(classifyInstall('C:\\Users\\me\\AppData\\Roaming\\npm\\codex.cmd', (path) => files[path.replaceAll('\\', '/')] ?? null)).toEqual({
            method: 'npm',
            package: '@openai/codex',
            version: '0.163.0',
            prefix: 'C:/Users/me/AppData/Roaming/npm'
        });
    });

    test('anything else is unknown', () => {
        expect(classifyInstall('/Users/me/.local/share/claude/versions/2.1.304', readText).method).toBe('unknown');
    });
});

describe('compareVersions', () => {
    test('compares part by part as numbers', () => {
        expect(compareVersions('1.10.0', '1.9.9')).toBe(1);
        expect(compareVersions('v2.0.0', '2.0.0')).toBe(0);
        expect(compareVersions('2.0', '2.0.1')).toBe(-1);
        expect(compareVersions('1.2.10', '1.2.9')).toBe(1);
    });

    test('ranks a release above its own prereleases, by semver precedence', () => {
        expect(compareVersions('1.0.0', '1.0.0-beta.1')).toBe(1);
        expect(compareVersions('1.0.0-beta.1', '1.0.0')).toBe(-1);
        expect(compareVersions('1.0.0-beta.11', '1.0.0-beta.2')).toBe(1);
        expect(compareVersions('1.0.0-alpha', '1.0.0-alpha.1')).toBe(-1);
        expect(compareVersions('1.0.0-alpha.1', '1.0.0-alpha.beta')).toBe(-1);
        expect(compareVersions('1.0.0-rc.1', '1.0.0-beta.2')).toBe(1);
        expect(compareVersions('1.0.1-beta.1', '1.0.0')).toBe(1);
        expect(compareVersions('1.0.0+build.2', '1.0.0+build.1')).toBe(0);
    });
});

describe('readBrewInfo', () => {
    test("takes a formula's stable version and whether Homebrew calls it outdated", () => {
        expect(readBrewInfo(JSON.stringify({ formulae: [{ versions: { stable: '26.11.1' }, outdated: true }], casks: [] }), false)).toEqual({
            latest: '26.11.1',
            outdated: true
        });
    });

    test('a cask without a version is never outdated', () => {
        expect(readBrewInfo(JSON.stringify({ formulae: [], casks: [{ version: 'latest', outdated: true }] }), true)).toEqual({ latest: null, outdated: false });
    });
});

const PROVIDERS = [
    { kind: 'claude', installed: true, version: '2.1.304' },
    { kind: 'copilot', installed: true, version: '1.0.101' }
] as unknown as ProviderInfo[];

const PATHS: Record<string, string> = {
    claude: '/Users/me/.local/bin/claude',
    copilot: '/opt/homebrew/bin/copilot',
    codex: '/opt/homebrew/bin/codex',
    npm: '/usr/local/bin/npm',
    brew: '/opt/homebrew/bin/brew'
};

const REAL: Record<string, string> = {
    '/Users/me/.local/bin/claude': '/Users/me/.local/share/claude/versions/2.1.304',
    '/opt/homebrew/bin/copilot': '/opt/homebrew/lib/node_modules/@github/copilot/npm-loader.js',
    '/opt/homebrew/bin/codex': '/opt/homebrew/Cellar/codex/0.160.0/bin/codex'
};

function versions(options: { run?: VersionRun; latest?: string; own?: OwnInstall | null; real?: (path: string) => string | undefined } = {}) {
    const ran: string[][] = [];
    const invalidated: string[] = [];
    let copilot = '1.0.101';
    const reader = (path: string): string | null =>
        path === '/opt/homebrew/lib/node_modules/@github/copilot/package.json' ? JSON.stringify({ version: copilot }) : readText(path);
    const cli = new CliVersions({
        executables: { claude: 'claude', copilot: 'copilot', codex: 'codex' },
        own: (kind) => (kind === 'antigravity' ? (options.own ?? null) : null),
        ownKinds: () => (options.own ? ['antigravity'] : []),
        providers: { current: async () => PROVIDERS, invalidate: (kind) => invalidated.push(kind) },
        which: (command) => PATHS[command] ?? null,
        realpath: (path) => options.real?.(path) ?? REAL[path] ?? path,
        readText: reader,
        exists: (path) => path === '/opt/homebrew/bin/brew',
        npmLatest: async () => options.latest ?? '1.0.110',
        run:
            options.run ??
            (async (command) => {
                ran.push(command);
                if (command.includes('info')) {
                    return { exitCode: 0, stdout: JSON.stringify({ formulae: [{ versions: { stable: '0.160.0' }, outdated: false }] }), stderr: '' };
                }
                copilot = '1.0.110';
                return { exitCode: 0, stdout: '', stderr: '' };
            }),
        now: () => 5_000
    });
    return { cli, ran, invalidated };
}

describe('CliVersions', () => {
    test('reads each CLI without starting it, and asks its route for the newest version', async () => {
        const { cli, ran } = versions();
        const list = await cli.list();
        expect(list.map((entry) => [entry.provider, entry.method, entry.version, entry.latest, entry.updatable])).toEqual([
            ['claude', 'unknown', '2.1.304', null, false],
            ['copilot', 'npm', '1.0.101', '1.0.110', true],
            ['codex', 'homebrew', '0.160.0', '0.160.0', false]
        ]);
        expect(ran).toEqual([['/opt/homebrew/bin/brew', 'info', '--json=v2', '--formula', 'codex']]);
    });

    test('updates through the route it was installed by, with the version it offered', async () => {
        const { cli, ran, invalidated } = versions();
        const after = await cli.update('copilot');
        expect(ran.at(-1)).toEqual(['/usr/local/bin/npm', 'install', '-g', '--prefix', '/opt/homebrew', '@github/copilot@1.0.110']);
        expect(after).toMatchObject({ state: 'idle', version: '1.0.110', updatable: false });
        expect(invalidated).toEqual(['copilot']);
    });

    test('says so when the route kept the version it had', async () => {
        const { cli } = versions({ run: async () => ({ exitCode: 0, stdout: '', stderr: '' }) });
        const after = await cli.update('copilot');
        expect(after.state).toBe('failed');
        expect(after.error).toContain('npm kept version 1.0.101');
    });

    test('a Homebrew upgrade that only rebuilds the formula at the same version succeeds', async () => {
        let codex = '/opt/homebrew/Cellar/codex/0.160.0_1/bin/codex';
        const { cli } = versions({
            real: (path) => (path === '/opt/homebrew/bin/codex' ? codex : undefined),
            run: async (command) => {
                if (command.includes('info')) {
                    return { exitCode: 0, stdout: JSON.stringify({ formulae: [{ versions: { stable: '0.160.0' }, outdated: true }] }), stderr: '' };
                }
                codex = '/opt/homebrew/Cellar/codex/0.160.0_2/bin/codex';
                return { exitCode: 0, stdout: '', stderr: '' };
            }
        });
        expect(await cli.update('codex')).toMatchObject({ method: 'homebrew', version: '0.160.0', state: 'idle' });
    });

    test('a Homebrew upgrade that kept the same revision is reported', async () => {
        const { cli } = versions({
            real: (path) => (path === '/opt/homebrew/bin/codex' ? '/opt/homebrew/Cellar/codex/0.160.0_1/bin/codex' : undefined),
            run: async (command) =>
                command.includes('info')
                    ? { exitCode: 0, stdout: JSON.stringify({ formulae: [{ versions: { stable: '0.160.0' }, outdated: true }] }), stderr: '' }
                    : { exitCode: 0, stdout: '', stderr: '' }
        });
        expect(await cli.update('codex')).toMatchObject({ state: 'failed', error: expect.stringContaining('Homebrew kept version 0.160.0') });
    });

    test('offers no update for a CLI installed some other way', async () => {
        const { cli } = versions();
        await expect(cli.update('claude')).rejects.toThrow('no update');
    });

    test("Ruimte's own install updates to the version it pins", async () => {
        let installed = '1.4.0';
        const own: OwnInstall = {
            get version() {
                return installed;
            },
            path: '/home/agent-servers/antigravity/1.4.0/server',
            latest: async () => '1.4.1',
            update: async () => {
                installed = '1.4.1';
            }
        };
        const { cli } = versions({ own });
        expect((await cli.one('antigravity')).updatable).toBe(true);
        expect(await cli.update('antigravity')).toMatchObject({ method: 'ruimte', version: '1.4.1', updatable: false, state: 'idle' });
    });
});
