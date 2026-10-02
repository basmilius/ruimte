import { describe, expect, test } from 'bun:test';
import { distTagOf, latestFromView, planPublish, publishedFromView, type PackageToPublish } from './publish-plan';

const PACKAGES: PackageToPublish[] = [
    { name: 'ruimte', dir: '/out/ruimte' },
    { name: '@ruimte/darwin-arm64', dir: '/out/darwin-arm64' },
    { name: '@ruimte/linux-x64', dir: '/out/linux-x64' }
];

const registry = (...entries: string[]) => {
    const asked: string[] = [];
    const lookup = {
        published: async (name: string, version: string): Promise<boolean> => {
            asked.push(`${name}@${version}`);
            return entries.includes(`${name}@${version}`);
        },
        // What `latest` points at: the newest stable version of the name on the registry.
        latest: async (name: string): Promise<string | null> => {
            const versions = entries
                .filter((entry) => entry.startsWith(`${name}@`))
                .map((entry) => entry.slice(name.length + 1))
                .filter((version) => !version.includes('-'));
            return versions.sort((a, b) => Bun.semver.order(a, b)).at(-1) ?? null;
        }
    };
    return { asked, lookup };
};

describe('planPublish', () => {
    test('platform packages first and the launcher last', async () => {
        const { lookup } = registry();
        const steps = await planPublish(PACKAGES, '0.2.0', lookup);
        expect(steps.map((step) => step.name)).toEqual(['@ruimte/darwin-arm64', '@ruimte/linux-x64', 'ruimte']);
        expect(steps.every((step) => step.action === 'publish' && step.tag === 'latest')).toBe(true);
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
        expect(distTagOf('1.0.0', null)).toBe('latest');
    });

    test('a release that finishes after a newer one leaves latest where it is', async () => {
        const { lookup } = registry('ruimte@0.11.1', '@ruimte/darwin-arm64@0.11.1', '@ruimte/linux-x64@0.11.1');
        const steps = await planPublish(PACKAGES, '0.11.0', lookup);
        expect(steps.map((step) => `${step.name} ${step.action} ${step.tag}`)).toEqual([
            '@ruimte/darwin-arm64 publish previous',
            '@ruimte/linux-x64 publish previous',
            'ruimte publish previous'
        ]);
        expect(distTagOf('0.11.2', '0.11.1')).toBe('latest');
        expect(distTagOf('0.10.0', '0.11.1')).toBe('previous');
    });
});

describe('latestFromView', () => {
    test('the version latest points at, or none for a package not on the registry yet', () => {
        expect(latestFromView({ code: 0, stdout: '0.11.1\n', stderr: '' })).toBe('0.11.1');
        expect(latestFromView({ code: 0, stdout: '', stderr: '' })).toBeNull();
        expect(latestFromView({ code: 1, stdout: '', stderr: 'npm error code E404' })).toBeNull();
        expect(() => latestFromView({ code: 1, stdout: '', stderr: 'npm error code ETIMEDOUT' })).toThrow('npm view failed (1)');
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
