import { describe, expect, test } from 'bun:test';
import { CONTENT_SECURITY_POLICY, notFoundForMissingAsset, withSecurityHeaders } from './headers';

function directive(name: string): string[] {
    return (
        CONTENT_SECURITY_POLICY.split(';')
            .map((part) => part.trim().split(/\s+/))
            .find((parts) => parts[0] === name)
            ?.slice(1) ?? []
    );
}

describe('the bench headers', () => {
    test('run no inline script and let nothing frame the page', () => {
        expect(directive('script-src')).toEqual(["'self'"]);
        expect(directive('frame-ancestors')).toEqual(["'none'"]);
        expect(directive('frame-src')).toEqual(["'none'"]);
        expect(directive('default-src')).toEqual(["'self'"]);
    });

    test('connect to the address book only', () => {
        expect(directive('connect-src')).toEqual(["'self'", 'https://pulsar.ruimte.app']);
    });

    test('every answer carries the policy and HSTS, and hashed assets are cached for good', () => {
        const page = withSecurityHeaders(new Response('<!doctype html>', { headers: { 'content-type': 'text/html' } }), '/');
        expect(page.headers.get('content-security-policy')).toBe(CONTENT_SECURITY_POLICY);
        expect(page.headers.get('strict-transport-security')).toContain('max-age=63072000');
        expect(page.headers.get('cache-control')).toBe('no-cache');

        const asset = withSecurityHeaders(new Response('x'), '/assets/bench-abc123.js');
        expect(asset.headers.get('cache-control')).toBe('public, max-age=31536000, immutable');
    });

    test('a missing chunk is a 404, not the page', () => {
        const page = new Response('<!doctype html>', { headers: { 'content-type': 'text/html' } });
        expect(notFoundForMissingAsset(page, '/assets/gone.js').status).toBe(404);
        expect(notFoundForMissingAsset(page, '/')).toBe(page);
    });
});
