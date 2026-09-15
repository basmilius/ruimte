import { describe, expect, test } from 'bun:test';
import { launcherManifest, platformManifest } from './manifest';

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
                '@ruimte/darwin-x64': '0.3.1',
                '@ruimte/linux-x64': '0.3.1',
                '@ruimte/linux-arm64': '0.3.1'
            }
        });
        expect(manifest.os).toBeUndefined();
    });
});
