import { describe, expect, test } from 'bun:test';
import { distTagOf, planPublish, publishedFromView, type PackageToPublish } from './publish-plan';

const PACKAGES: PackageToPublish[] = [
    { name: 'ruimte', dir: '/out/ruimte' },
    { name: '@ruimte/darwin-arm64', dir: '/out/darwin-arm64' },
    { name: '@ruimte/linux-x64', dir: '/out/linux-x64' }
];

/* A registry that holds the listed `name@version` entries. */
const registry = (...entries: string[]) => {
    const asked: string[] = [];
    const lookup = async (name: string, version: string): Promise<boolean> => {
        asked.push(`${name}@${version}`);
        return entries.includes(`${name}@${version}`);
    };
    return { asked, lookup };
};

describe('planPublish', () => {
    test('platform packages first and the launcher last', async () => {
        const { lookup } = registry();
        const steps = await planPublish(PACKAGES, '0.2.0', lookup);
        expect(steps.map((step) => step.name)).toEqual(['@ruimte/darwin-arm64', '@ruimte/linux-x64', 'ruimte']);
        expect(steps.every((step) => step.action === 'publish' && step.tag === null)).toBe(true);
    });

    test('skips what the registry already has, so a failed run can go again', async () => {
        const { lookup, asked } = registry('@ruimte/darwin-arm64@0.2.0', 'ruimte@0.1.0');
        const steps = await planPublish(PACKAGES, '0.2.0', lookup);
        expect(steps.map((step) => `${step.name} ${step.action}`)).toEqual(['@ruimte/darwin-arm64 skip', '@ruimte/linux-x64 publish', 'ruimte publish']);
        expect(asked).toEqual(['@ruimte/darwin-arm64@0.2.0', '@ruimte/linux-x64@0.2.0', 'ruimte@0.2.0']);
    });

    test('a prerelease goes out under next', async () => {
        const { lookup } = registry();
        const steps = await planPublish(PACKAGES, '0.3.0-beta.1', lookup);
        expect(steps.every((step) => step.tag === 'next')).toBe(true);
        expect(distTagOf('1.0.0')).toBeNull();
    });
});

describe('publishedFromView', () => {
    test('a version npm prints is published', () => {
        expect(publishedFromView('0.2.0', { code: 0, stdout: '0.2.0\n', stderr: '' })).toBe(true);
    });

    test('a package without that version prints nothing', () => {
        expect(publishedFromView('0.2.0', { code: 0, stdout: '', stderr: '' })).toBe(false);
    });

    test('a package that does not exist yet is E404', () => {
        expect(publishedFromView('0.2.0', { code: 1, stdout: '', stderr: 'npm error code E404\nnpm error 404 Not Found' })).toBe(false);
    });

    test('any other failure is no answer', () => {
        expect(() => publishedFromView('0.2.0', { code: 1, stdout: '', stderr: 'npm error code ETIMEDOUT' })).toThrow('npm view failed (1)');
    });
});
