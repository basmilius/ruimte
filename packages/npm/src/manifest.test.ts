import { describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import { catalogOf, extensionManifest, launcherManifest, platformManifest, type Manifest } from './manifest';

const repoRoot = join(import.meta.dir, '..', '..', '..');

describe('platformManifest', () => {
    test('a macOS package holds its binary and installs on that platform only', () => {
        expect(platformManifest({ os: 'darwin', cpu: 'arm64' }, '0.2.0')).toEqual({
            name: '@ruimte/darwin-arm64',
            version: '0.2.0',
            description: 'The Ruimte machine for macOS on arm64. Install ruimte instead; it picks this package for you.',
            license: 'FSL-1.1-MIT',
            author: 'Bas Milius',
            homepage: 'https://ruimte.app',
            repository: { type: 'git', url: 'git+https://github.com/basmilius/ruimte.git', directory: 'packages/npm' },
            os: ['darwin'],
            cpu: ['arm64'],
            files: ['bin']
        });
    });

    test('a Linux package asks for glibc', () => {
        const manifest = platformManifest({ os: 'linux', cpu: 'x64' }, '0.2.0');
        expect(manifest).toMatchObject({ name: '@ruimte/linux-x64', os: ['linux'], cpu: ['x64'], libc: ['glibc'] });
    });

    test('a Windows package installs on win32 and asks for no libc', () => {
        const manifest = platformManifest({ os: 'win32', cpu: 'x64' }, '0.2.0');
        expect(manifest).toMatchObject({ name: '@ruimte/win32-x64', os: ['win32'], cpu: ['x64'] });
        expect(manifest.description).toContain('for Windows on x64');
        expect(manifest.libc).toBeUndefined();
    });
});

describe('extensionManifest', () => {
    test('goes out at the app version with its own name, license and exports', () => {
        const source = { name: '@ruimte/extension', version: '1.0.0', license: 'MIT', files: ['*.d.ts'], exports: { './client': { types: './client.d.ts' } } };

        expect(extensionManifest(source, '0.30.0-beta.1', {})).toEqual({
            ...source,
            version: '0.30.0-beta.1',
            author: 'Bas Milius',
            homepage: 'https://ruimte.app',
            repository: { type: 'git', url: 'git+https://github.com/basmilius/ruimte.git', directory: 'packages/extension' }
        });
    });

    test('writes the catalog version for every catalog reference', () => {
        const source = {
            name: '@ruimte/extension',
            dependencies: { '@adecore/ui': 'catalog:' },
            peerDependencies: { '@adecore/agents-react': 'catalog:', '@types/react': '^19.0.0' },
            peerDependenciesMeta: { '@adecore/agents-react': { optional: true } }
        };

        expect(extensionManifest(source, '0.30.0', { '@adecore/ui': '0.56.2', '@adecore/agents-react': '0.56.2' })).toMatchObject({
            dependencies: { '@adecore/ui': '0.56.2' },
            peerDependencies: { '@adecore/agents-react': '0.56.2', '@types/react': '^19.0.0' },
            peerDependenciesMeta: { '@adecore/agents-react': { optional: true } }
        });
    });

    test('fails on a catalog reference the root catalog lacks', () => {
        const source = { name: '@ruimte/extension', dependencies: { '@adecore/ui': 'catalog:' } };

        expect(() => extensionManifest(source, '0.30.0', { '@adecore/charts': '0.56.2' })).toThrow('@adecore/ui in dependencies is "catalog:"');
    });

    test('fails on a named catalog, which the root does not keep', () => {
        const source = { name: '@ruimte/extension', dependencies: { '@adecore/ui': 'catalog:other' } };

        expect(() => extensionManifest(source, '0.30.0', { '@adecore/ui': '0.56.2' })).toThrow('"catalog:other"');
    });

    test('the manifest of packages/extension resolves against the root catalog', async () => {
        const root = JSON.parse(await Bun.file(join(repoRoot, 'package.json')).text()) as Manifest;
        const source = JSON.parse(await Bun.file(join(repoRoot, 'packages', 'extension', 'package.json')).text()) as Manifest;
        const published = JSON.stringify(extensionManifest(source, '0.30.0', catalogOf(root)));

        expect(published).not.toContain('catalog:');
    });
});

describe('launcherManifest', () => {
    test('pins every platform package to the release version', () => {
        const manifest = launcherManifest('0.3.1');
        expect(manifest).toMatchObject({
            name: 'ruimte',
            version: '0.3.1',
            type: 'module',
            bin: { ruimte: 'bin/ruimte.js' },
            license: 'FSL-1.1-MIT',
            optionalDependencies: {
                '@ruimte/darwin-arm64': '0.3.1',
                '@ruimte/linux-x64': '0.3.1',
                '@ruimte/linux-arm64': '0.3.1',
                '@ruimte/win32-x64': '0.3.1'
            }
        });
        expect(manifest.os).toBeUndefined();
    });

    test('leaves a platform the release skips out of the install', () => {
        const manifest = launcherManifest('0.3.1', [{ os: 'darwin', cpu: 'arm64' }]);
        expect(manifest.optionalDependencies).toEqual({ '@ruimte/darwin-arm64': '0.3.1' });
    });
});
