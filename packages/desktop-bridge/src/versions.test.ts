import { describe, expect, test } from 'bun:test';
import { compareVersions, isVersion } from './versions.ts';

describe('compareVersions', () => {
    test('orders by number and not by text', () => {
        expect(compareVersions('0.0.10', '0.0.9')).toBeGreaterThan(0);
        expect(compareVersions('1.0.0', '0.9.9')).toBeGreaterThan(0);
        expect(compareVersions('0.0.8', '0.0.8')).toBe(0);
        expect(compareVersions('0.0.7', '0.0.8')).toBeLessThan(0);
    });

    test('anything that is not a version sorts below every version', () => {
        expect(compareVersions('0.0.1', 'nightly')).toBeGreaterThan(0);
        expect(compareVersions('nightly', 'nightly')).toBe(0);
    });

    test('a tag is not a version: the `v` comes off before anything is compared', () => {
        expect(compareVersions('v0.0.9', '0.0.8')).toBeLessThan(0);
    });
});

describe('isVersion', () => {
    test('a bare semver and nothing else', () => {
        expect(isVersion('1.2.3')).toBe(true);
        expect(isVersion('v1.2.3')).toBe(false);
        expect(isVersion('1.2')).toBe(false);
        expect(isVersion('1.2.3-beta.1')).toBe(false);
    });
});
