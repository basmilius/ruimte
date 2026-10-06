import { afterAll, beforeEach, describe, expect, test } from 'bun:test';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, renameSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
    packageStatus,
    peerVersionDrift,
    statusMode,
    linkLocalPackages,
    replacePackageLink,
    restoreNpmPackages,
    type RunCommand,
    type LinkPackage
} from './adecore.ts';

const root = mkdtempSync('/private/tmp/ruimte-adecore-integration-');
const ruimte = join(root, 'ruimte');
const adecore = join(root, 'adecore');
const core = join(adecore, 'packages/editor-core');
const editor = join(adecore, 'packages/editor');
const client = join(ruimte, 'apps/client');
const server = join(ruimte, 'apps/server');
const env = { ...process.env, ADECORE_PATH: adecore, BUN_INSTALL: join(root, 'bun'), BUN_INSTALL_CACHE_DIR: join(root, 'cache') };

const run: RunCommand = async (cwd, args) => {
    const child = Bun.spawn([process.execPath, ...args], { cwd, env, stdout: 'pipe', stderr: 'pipe' });
    const [code, stdout, stderr] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
    if (code !== 0) {
        throw new Error(`${args.join(' ')}: ${stderr || stdout}`);
    }
};

function manifest(folder: string, data: object): void {
    mkdirSync(folder, { recursive: true });
    writeFileSync(join(folder, 'package.json'), JSON.stringify(data));
}

function trackedFiles(): Map<string, string> {
    return new Map(
        [ruimte, client, server, adecore, core, editor].map((folder) => [join(folder, 'package.json'), readFileSync(join(folder, 'package.json'), 'utf8')])
    );
}

async function cli(args: string[], localPath = adecore): Promise<{ code: number; stdout: string; stderr: string }> {
    const child = Bun.spawn([process.execPath, join(ruimte, 'scripts/adecore.ts'), ...args], {
        cwd: ruimte,
        env: { ...env, ADECORE_PATH: localPath },
        stdout: 'pipe',
        stderr: 'pipe'
    });
    const [code, stdout, stderr] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
    return { code, stdout, stderr };
}

async function value(): Promise<string> {
    const child = Bun.spawn([process.execPath, '--conditions=source', '-e', 'console.log((await import("@adecore/editor")).value)'], {
        cwd: client,
        env,
        stdout: 'pipe',
        stderr: 'pipe'
    });
    const [code, stdout, stderr] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
    expect(code, stderr).toBe(0);
    return stdout.trim();
}

beforeEach(async () => {
    rmSync(root, { recursive: true, force: true });
    mkdirSync(root);
    manifest(core, { name: '@adecore/editor-core', version: '1.0.0', type: 'module', exports: { '.': { source: './source.ts', default: './index.js' } } });
    writeFileSync(join(core, 'source.ts'), 'export const value = "published";');
    writeFileSync(join(core, 'index.js'), 'export const value = "compiled";');
    await run(core, ['pm', 'pack', '--filename', join(root, 'core.tgz')]);
    manifest(editor, {
        name: '@adecore/editor',
        version: '1.0.0',
        type: 'module',
        exports: { '.': { source: './source.ts', default: './index.js' } },
        dependencies: { '@adecore/editor-core': `file:${join(root, 'core.tgz')}` }
    });
    writeFileSync(join(editor, 'source.ts'), 'export { value } from "@adecore/editor-core";');
    writeFileSync(join(editor, 'index.js'), 'export const value = "stale compiled editor";');
    await run(editor, ['pm', 'pack', '--filename', join(root, 'editor.tgz')]);
    manifest(adecore, { name: 'adecore', private: true, workspaces: ['packages/*'] });
    manifest(editor, { ...JSON.parse(readFileSync(join(editor, 'package.json'), 'utf8')), dependencies: { '@adecore/editor-core': 'workspace:*' } });
    writeFileSync(join(core, 'source.ts'), 'export const value = "local";');
    await run(adecore, ['install', '--offline']);
    manifest(ruimte, { name: 'ruimte', private: true, workspaces: ['apps/*'] });
    manifest(client, { name: 'client', dependencies: { '@adecore/editor': `file:${join(root, 'editor.tgz')}` } });
    manifest(server, {
        name: 'server',
        dependencies: { '@adecore/editor-core': `file:${join(root, 'core.tgz')}` }
    });
    await run(ruimte, ['install', '--offline']);
    mkdirSync(join(ruimte, 'scripts'));
    copyFileSync(join(import.meta.dir, 'adecore.ts'), join(ruimte, 'scripts/adecore.ts'));
    expect(statusMode(packageStatus(ruimte, adecore))).toBe('npm');
});

afterAll(() => {
    rmSync(root, { recursive: true, force: true });
});

describe('ADE CORE package switching with Bun', () => {
    test('links each consumer and transitive dependencies, reads live source, and preserves manifests and locks', async () => {
        const before = trackedFiles();
        const lock = readFileSync(join(ruimte, 'bun.lock'), 'utf8');
        const sourceLock = readFileSync(join(adecore, 'bun.lock'), 'utf8');
        expect(await value()).toBe('published');
        linkLocalPackages(ruimte, adecore);
        expect(statusMode(packageStatus(ruimte, adecore))).toBe('local');
        expect(await value()).toBe('local');
        writeFileSync(join(core, 'source.ts'), 'export const value = "edited without a build";');
        expect(await value()).toBe('edited without a build');
        expect(packageStatus(ruimte, adecore).every((pkg) => pkg.mode === 'local')).toBe(true);
        linkLocalPackages(ruimte, adecore);
        expect(trackedFiles()).toEqual(before);
        expect(readFileSync(join(ruimte, 'bun.lock'), 'utf8')).toBe(lock);
        expect(readFileSync(join(adecore, 'bun.lock'), 'utf8')).toBe(sourceLock);
    });

    test('restores pinned packages without needing the local source folder', async () => {
        linkLocalPackages(ruimte, adecore);
        renameSync(adecore, `${adecore}-moved`);
        try {
            await restoreNpmPackages(ruimte, adecore, run);
            expect(statusMode(packageStatus(ruimte, adecore))).toBe('npm');
            expect(await value()).toBe('published');
            await restoreNpmPackages(ruimte, adecore, run);
        } finally {
            renameSync(`${adecore}-moved`, adecore);
        }
    });

    test('Bun watch restarts for a source edit in the linked folder', async () => {
        linkLocalPackages(ruimte, adecore);
        writeFileSync(join(core, 'source.ts'), 'export const value = "watch original";');
        const entry = join(server, 'watch.ts');
        writeFileSync(entry, 'import { value } from "@adecore/editor-core"; console.log(value); setInterval(() => {}, 1000);');
        const child = Bun.spawn([process.execPath, '--conditions=source', '--watch', entry], { cwd: server, env, stdout: 'pipe', stderr: 'ignore' });
        const reader = child.stdout.getReader();
        const until = async (marker: string): Promise<void> => {
            let output = '';
            while (!output.includes(marker)) {
                const next = await reader.read();
                if (next.done) {
                    throw new Error(`The watcher exited before ${marker}.`);
                }
                output += new TextDecoder().decode(next.value);
            }
        };
        try {
            await until('watch original');
            writeFileSync(join(core, 'source.ts'), 'export const value = "watch picked up the edit";');
            await until('watch picked up the edit');
        } finally {
            child.kill();
            await child.exited;
            await reader.cancel();
            await restoreNpmPackages(ruimte, adecore, run);
        }
    });

    test('rejects a stale transitive ADE CORE link before switching any consumer', async () => {
        const dependency = join(editor, 'node_modules/@adecore/editor-core');
        const original = realpathSync(dependency);
        unlinkSync(dependency);
        symlinkSync(join(server, 'node_modules/@adecore/editor-core'), dependency);
        try {
            expect(() => linkLocalPackages(ruimte, adecore)).toThrow('must resolve @adecore/editor-core');
            expect(statusMode(packageStatus(ruimte, adecore))).toBe('npm');
        } finally {
            unlinkSync(dependency);
            symlinkSync(original, dependency);
        }
    });

    test('restores prior consumer aliases after a partial link failure', async () => {
        const interrupted: LinkPackage = (path, target) => {
            if (path.startsWith(server)) {
                throw new Error('Fixture link failure');
            }
            replacePackageLink(path, target);
        };
        expect(() => linkLocalPackages(ruimte, adecore, interrupted)).toThrow('Fixture link failure');
        expect(statusMode(packageStatus(ruimte, adecore))).toBe('npm');
        expect(await value()).toBe('published');
    });

    test('reports a mixed consumer graph', async () => {
        const dependency = join(client, 'node_modules/@adecore/editor');
        unlinkSync(dependency);
        symlinkSync(editor, dependency);
        expect(statusMode(packageStatus(ruimte, adecore))).toBe('mixed');
        await restoreNpmPackages(ruimte, adecore, run);
    });

    test('checks npm restoration against the configured local folder even inside node_modules', async () => {
        const alternate = join(ruimte, 'node_modules/local-adecore');
        renameSync(adecore, alternate);
        linkLocalPackages(ruimte, alternate);
        const noInstall: RunCommand = async (cwd, args) => {
            expect(cwd).toBe(realpathSync(ruimte));
            expect(args).toEqual(['install', '--frozen-lockfile']);
        };
        await expect(restoreNpmPackages(ruimte, alternate, noInstall)).rejects.toThrow('still resolve outside the npm install');
        expect(statusMode(packageStatus(ruimte, alternate))).toBe('local');
        await restoreNpmPackages(ruimte, alternate, run);
        expect(statusMode(packageStatus(ruimte, alternate))).toBe('npm');
    });

    test('refuses npm restoration when a changed dependency would alter the frozen lockfile', async () => {
        const lock = readFileSync(join(ruimte, 'bun.lock'), 'utf8');
        const extra = join(root, 'extra');
        manifest(extra, { name: 'fixture-new', version: '1.0.0' });
        await run(extra, ['pm', 'pack', '--filename', join(root, 'extra.tgz')]);
        manifest(client, {
            name: 'client',
            dependencies: { '@adecore/editor': `file:${join(root, 'editor.tgz')}`, 'fixture-new': `file:${join(root, 'extra.tgz')}` }
        });
        await expect(restoreNpmPackages(ruimte, adecore, run)).rejects.toThrow('lockfile is frozen');
        expect(readFileSync(join(ruimte, 'bun.lock'), 'utf8')).toBe(lock);
    });

    test('shows a brief npm banner and detects install fallback from local mode', async () => {
        expect(await cli(['status', '--brief', '--npm'])).toEqual({ code: 0, stdout: 'ADE CORE: npm (2 consumers)\n', stderr: '' });
        linkLocalPackages(ruimte, adecore);
        const local = await cli(['status', '--brief'], '../adecore');
        expect(local.code).toBe(0);
        expect(local.stdout).toBe(`ADE CORE: local (2 consumers; ${adecore})\n`);
        expect((await cli(['status', '--brief', '--npm'])).code).toBe(1);
        await run(ruimte, ['install', '--frozen-lockfile']);
        expect((await cli(['status', '--brief', '--npm'])).stdout).toBe('ADE CORE: npm (2 consumers)\n');
    });

    test('keeps brief mixed status fatal and rejects invalid CLI arguments', async () => {
        replacePackageLink(join(client, 'node_modules/@adecore/editor'), editor);
        expect((await cli(['status', '--brief'])).code).toBe(1);
        expect((await cli(['status', '--brief'])).stdout).toContain('ADE CORE: mixed (2 consumers;');
        expect((await cli(['npm', '--brief'])).code).toBe(1);
        expect((await cli(['status', '--unknown'])).code).toBe(1);
    });

    test('prints the package mode before workspace dev commands and blocks mixed startup', async () => {
        const dev = JSON.parse(readFileSync(join(import.meta.dir, '../package.json'), 'utf8')).scripts.dev;
        manifest(ruimte, { ...JSON.parse(readFileSync(join(ruimte, 'package.json'), 'utf8')), scripts: { dev } });
        for (const folder of [client, server]) {
            manifest(folder, {
                ...JSON.parse(readFileSync(join(folder, 'package.json'), 'utf8')),
                scripts: { dev: `bun -e 'console.log("fixture dev started")'` }
            });
        }
        const start = async () => {
            const child = Bun.spawn([process.execPath, 'dev'], { cwd: ruimte, env, stdout: 'pipe', stderr: 'pipe' });
            const [code, stdout, stderr] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
            return { code, stdout, stderr };
        };
        const npm = await start();
        expect(npm.code, npm.stderr).toBe(0);
        expect(npm.stdout.indexOf('ADE CORE: npm')).toBeLessThan(npm.stdout.indexOf('fixture dev started'));
        linkLocalPackages(ruimte, adecore);
        const local = await start();
        expect(local.code, local.stderr).toBe(0);
        expect(local.stdout).toContain('ADE CORE: local');
        await restoreNpmPackages(ruimte, adecore, run);
        replacePackageLink(join(client, 'node_modules/@adecore/editor'), editor);
        const mixed = await start();
        expect(mixed.code).toBe(1);
        expect(mixed.stdout).toContain('ADE CORE: mixed');
        expect(mixed.stdout).not.toContain('fixture dev started');
    });

    test('advises concrete peer and transitive zod drift without failing status or deduping other libraries', async () => {
        manifest(editor, {
            ...JSON.parse(readFileSync(join(editor, 'package.json'), 'utf8')),
            peerDependencies: { react: '^19.0.0', electron: '^44.0.0', missing: '*' },
            dependencies: { '@adecore/editor-core': 'workspace:*', clsx: '^2.0.0', zustand: '^5.0.0' }
        });
        manifest(core, { ...JSON.parse(readFileSync(join(core, 'package.json'), 'utf8')), dependencies: { zod: '^4.0.0' } });
        for (const [name, local, installed] of [
            ['react', '19.3.0', '19.2.0'],
            ['electron', '44.5.1', '44.4.4'],
            ['zod', '4.6.5', '4.6.4'],
            ['zustand', '5.0.15', '5.0.14'],
            ['clsx', '2.1.1', '2.0.0']
        ]) {
            manifest(join(name === 'zod' ? core : editor, 'node_modules', name!), { name, version: local });
            manifest(join(ruimte, 'node_modules', name!), { name, version: installed });
        }
        linkLocalPackages(ruimte, adecore);
        const advice = peerVersionDrift(ruimte, adecore);
        expect(advice).toHaveLength(5);
        expect(advice).toContain(
            'apps/client: react is 19.2.0 in Ruimte and 19.3.0 in ADE CORE via @adecore/editor. Align versions if this affects the consumer.'
        );
        expect(advice.some((warning) => warning.includes('electron') && warning.includes('types; runtime is external'))).toBe(true);
        expect(advice.filter((warning) => warning.includes('zod'))).toHaveLength(2);
        expect(advice.some((warning) => warning.includes('zustand is 5.0.14 in Ruimte and 5.0.15 in ADE CORE'))).toBe(true);
        expect(advice.some((warning) => warning.includes('clsx') || warning.includes('missing'))).toBe(false);
        const status = await cli(['status']);
        expect(status.code).toBe(0);
        expect(status.stderr).toContain('Version advice: apps/client: react');
        expect((await cli(['status', '--npm'])).code).toBe(1);
        manifest(join(ruimte, 'node_modules/react'), { name: 'react', version: '19.3.0' });
        expect(peerVersionDrift(ruimte, adecore).some((warning) => warning.includes('react is'))).toBe(false);
        await restoreNpmPackages(ruimte, adecore, run);
        expect(peerVersionDrift(ruimte, adecore)).toEqual([]);
    });
});
