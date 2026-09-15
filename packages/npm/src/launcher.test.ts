import { describe, expect, test } from 'bun:test';
import { binaryPathOf, exitCodeOf, LauncherError, platformPackageOf, WINDOWS_REFUSAL, type Resolve } from './launcher';

/* A resolver over the packages npm installed, by name. */
const installed =
    (...names: string[]): Resolve =>
    (request) => {
        const name = names.find((candidate) => request === `${candidate}/package.json`);
        if (!name) {
            throw new Error(`Cannot find module '${request}'`);
        }
        return `/project/node_modules/${name}/package.json`;
    };

describe('platformPackageOf', () => {
    test('one package per supported platform', () => {
        expect(platformPackageOf({ platform: 'darwin', arch: 'arm64' })).toBe('@ruimte/darwin-arm64');
        expect(platformPackageOf({ platform: 'darwin', arch: 'x64' })).toBe('@ruimte/darwin-x64');
        expect(platformPackageOf({ platform: 'linux', arch: 'x64' })).toBe('@ruimte/linux-x64');
        expect(platformPackageOf({ platform: 'linux', arch: 'arm64' })).toBe('@ruimte/linux-arm64');
    });

    test('says Windows is not supported yet', () => {
        expect(() => platformPackageOf({ platform: 'win32', arch: 'x64' })).toThrow(WINDOWS_REFUSAL);
    });

    test('names a platform or architecture it has no build for', () => {
        expect(() => platformPackageOf({ platform: 'freebsd', arch: 'x64' })).toThrow('Ruimte has no build for freebsd on x64.');
        expect(() => platformPackageOf({ platform: 'linux', arch: 'ia32' })).toThrow(LauncherError);
    });
});

describe('binaryPathOf', () => {
    test('the binary inside the platform package npm installed', () => {
        const path = binaryPathOf({ platform: 'linux', arch: 'arm64' }, installed('@ruimte/linux-arm64'));
        expect(path).toBe('/project/node_modules/@ruimte/linux-arm64/bin/ruimte');
    });

    test('explains a platform package left out of the install', () => {
        expect(() => binaryPathOf({ platform: 'darwin', arch: 'arm64' }, installed('@ruimte/linux-x64'))).toThrow(
            'The package @ruimte/darwin-arm64 is missing.'
        );
    });

    test('refuses Windows before it looks for a package', () => {
        let asked = false;
        const resolve: Resolve = () => {
            asked = true;
            return '';
        };
        expect(() => binaryPathOf({ platform: 'win32', arch: 'arm64' }, resolve)).toThrow(WINDOWS_REFUSAL);
        expect(asked).toBe(false);
    });
});

describe('exitCodeOf', () => {
    test('the code of a binary that exited, and 128 plus the signal of one that was killed', () => {
        expect(exitCodeOf(0, null)).toBe(0);
        expect(exitCodeOf(3, null)).toBe(3);
        expect(exitCodeOf(null, 2)).toBe(130);
        expect(exitCodeOf(null, null)).toBe(1);
    });
});
