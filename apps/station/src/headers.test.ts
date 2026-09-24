import { describe, expect, test } from 'bun:test';
import { CONTENT_SECURITY_POLICY, notFoundForMissingAsset, withSecurityHeaders } from './headers';

const directive = (name: string): string[] =>
    CONTENT_SECURITY_POLICY.split(';')
        .map((part) => part.trim().split(/\s+/))
        .find((parts) => parts[0] === name)
        ?.slice(1) ?? [];

describe('the station headers', () => {
    test('run no inline script and let nothing frame the page', () => {
        expect(directive('script-src')).toEqual(["'self'", "'wasm-unsafe-eval'"]);
        expect(directive('frame-ancestors')).toEqual(["'none'"]);
        expect(directive('default-src')).toEqual(["'self'"]);
        expect(CONTENT_SECURITY_POLICY).not.toContain("'unsafe-eval'");
    });

    test('connect to the address book and secure sockets only, never plain ones', () => {
        const connect = directive('connect-src');
        expect(connect).toContain('https://pulsar.ruimte.app');
        expect(connect).toContain('wss:');
        expect(connect).not.toContain('ws:');
        expect(connect).not.toContain('http:');
    });

    test('every answer carries the policy, HSTS and the referrer policy, and hashed assets are cached for good', async () => {
        const page = withSecurityHeaders(new Response('<!doctype html>', { headers: { 'content-type': 'text/html' } }), '/pulsar/callback');
        expect(page.headers.get('content-security-policy')).toBe(CONTENT_SECURITY_POLICY);
        expect(page.headers.get('strict-transport-security')).toContain('max-age=63072000');
        expect(page.headers.get('referrer-policy')).toBe('no-referrer');
        expect(page.headers.get('cache-control')).toBe('no-cache');
        expect(page.headers.get('content-type')).toBe('text/html');
        expect(await page.text()).toBe('<!doctype html>');

        const asset = withSecurityHeaders(new Response('x'), '/assets/index-abc123.js');
        expect(asset.headers.get('cache-control')).toBe('public, max-age=31536000, immutable');

        const missing = withSecurityHeaders(new Response('gone', { status: 404 }), '/assets/nothing.js');
        expect(missing.status).toBe(404);
        expect(missing.headers.get('cache-control')).toBeNull();
        expect(missing.headers.get('content-security-policy')).toBe(CONTENT_SECURITY_POLICY);
    });

    test('a chunk that is gone is a 404, never the page cached as that chunk', () => {
        const page = (): Response => new Response('<!doctype html>', { headers: { 'content-type': 'text/html; charset=utf-8' } });

        const gone = withSecurityHeaders(notFoundForMissingAsset(page(), '/assets/WorkspaceShell-old.js'), '/assets/WorkspaceShell-old.js');
        expect(gone.status).toBe(404);
        expect(gone.headers.get('cache-control')).toBeNull();

        expect(notFoundForMissingAsset(page(), '/pulsar/callback').status).toBe(200);
        const chunk = new Response('x', { headers: { 'content-type': 'text/javascript' } });
        expect(notFoundForMissingAsset(chunk, '/assets/index-abc123.js')).toBe(chunk);
    });
});
