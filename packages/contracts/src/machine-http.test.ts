import { describe, expect, test } from 'bun:test';
import { buildIdentityOf, isIdle, isLocalProof, localProofOf, machineWorkOf } from './machine-http.ts';

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

describe('localProofOf', () => {
    test('is the HMAC of the port and the nonce under the secret, so only a holder of the secret on that port can make it', async () => {
        const proof = await localProofOf('the-secret', 4210, 'nonce-of-the-shell');
        expect(proof).toMatch(/^[A-Za-z0-9_-]{43}$/);
        expect(await localProofOf('the-secret', 4210, 'nonce-of-the-shell')).toBe(proof);
        expect(await localProofOf('another-secret', 4210, 'nonce-of-the-shell')).not.toBe(proof);
        expect(await localProofOf('the-secret', 4300, 'nonce-of-the-shell')).not.toBe(proof);
        expect(await localProofOf('the-secret', 4210, 'another-nonce')).not.toBe(proof);
    });

    test('a reply proves the secret only when it carries that HMAC', async () => {
        const proof = await localProofOf('the-secret', 4210, 'nonce-of-the-shell');
        expect(await isLocalProof({ proof }, 'the-secret', 4210, 'nonce-of-the-shell')).toBe(true);
        expect(await isLocalProof({ proof }, 'the-secret', 4211, 'nonce-of-the-shell')).toBe(false);
        expect(await isLocalProof({ proof: 'made-up' }, 'the-secret', 4210, 'nonce-of-the-shell')).toBe(false);
        expect(await isLocalProof('Not found', 'the-secret', 4210, 'nonce-of-the-shell')).toBe(false);
    });
});
