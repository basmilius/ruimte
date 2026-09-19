import { describe, expect, test } from 'bun:test';
import { buildIdentityOf, isIdle, machineWorkOf } from './machine-http.ts';

describe('buildIdentityOf', () => {
    test('reads the version and the build', () => {
        expect(buildIdentityOf({ ok: true, version: '0.1.0', build: 'b', service: true })).toEqual({ version: '0.1.0', build: 'b' });
        expect(buildIdentityOf({ ok: true, version: '0.1.0' })).toEqual({ version: '0.1.0', build: null });
    });

    test('anything that is not a daemon saying it is well is no answer', () => {
        expect(buildIdentityOf(null)).toBeNull();
        expect(buildIdentityOf({ ok: false, version: '0.1.0' })).toBeNull();
        expect(buildIdentityOf({ version: '0.1.0' })).toBeNull();
        expect(buildIdentityOf({ ok: true })).toBeNull();
    });
});

describe('machineWorkOf', () => {
    test('reads the counts and nothing else', () => {
        expect(machineWorkOf({ terminals: 1, agents: 2 })).toEqual({ terminals: 1, agents: 2 });
        expect(machineWorkOf({ terminals: -1, agents: 2 })).toBeNull();
        expect(machineWorkOf('Not found')).toBeNull();
    });
});

describe('isIdle', () => {
    test('is idle only with nothing running at all', () => {
        expect(isIdle({ terminals: 0, agents: 0 })).toBe(true);
        expect(isIdle({ terminals: 1, agents: 0 })).toBe(false);
        expect(isIdle({ terminals: 0, agents: 1 })).toBe(false);
    });
});
