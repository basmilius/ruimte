import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { cspString, VISUAL_HOST_CSP, VISUAL_HOST_CSP_DIRECTIVES, VISUAL_HOST_HEADERS, VISUAL_HOST_PATH } from './index.ts';

const INDEX_HTML = join(import.meta.dir, '..', '..', '..', 'apps', 'client', 'index.html');

describe('the client policy', () => {
    /*
     * The html cannot import, so this is what keeps the tag and the headers together: a directive
     * changed in one place fails the run instead of leaving the dev server under another policy
     * than the served client.
     */
    test('is the one in the meta tag of index.html, to the character', () => {
        const html = readFileSync(INDEX_HTML, 'utf8');
        const tag = /<meta http-equiv="Content-Security-Policy" content="([^"]+)"/.exec(html);
        expect(tag?.[1]).toBe(cspString());
    });

    test('an override replaces a directive whole and an unknown name is added', () => {
        const stricter = cspString({ 'base-uri': ["'none'"], 'manifest-src': ["'self'"] });
        expect(stricter).toContain("base-uri 'none'");
        expect(stricter).not.toContain("base-uri 'self'");
        expect(stricter.endsWith("manifest-src 'self'")).toBe(true);
    });
});

function directiveOf(policy: string, name: string): string[] | undefined {
    return policy
        .split(';')
        .map((part) => part.trim().split(/\s+/))
        .find((parts) => parts[0] === name)
        ?.slice(1);
}

describe('the client policy and visuals', () => {
    test('a frame of the client shows only what its own origin serves, which is where the host page of a visual is', () => {
        expect(directiveOf(cspString(), 'frame-src')).toEqual(["'self'"]);
        expect(VISUAL_HOST_PATH).toBe('/__visual/');
    });
});

describe('the policy of the host page of a visual', () => {
    test('runs inline scripts and styles and loads public sources', () => {
        expect(directiveOf(VISUAL_HOST_CSP, 'default-src')).toEqual(["'none'"]);
        expect(directiveOf(VISUAL_HOST_CSP, 'script-src')).toEqual(["'unsafe-inline'", "'unsafe-eval'", 'https:', 'data:', 'blob:']);
        expect(directiveOf(VISUAL_HOST_CSP, 'style-src')).toEqual(["'unsafe-inline'", 'https:', 'data:']);
        for (const name of ['img-src', 'font-src', 'media-src', 'connect-src', 'frame-src']) {
            expect(directiveOf(VISUAL_HOST_CSP, name)).toContain('https:');
        }
        expect(directiveOf(VISUAL_HOST_CSP, 'connect-src')).toContain('wss:');
    });

    test('never reaches plain http or the client, submits no form and is framed by the client alone', () => {
        expect(VISUAL_HOST_CSP).not.toContain('http:');
        expect(VISUAL_HOST_CSP).not.toContain('ws:');
        for (const [name, values] of Object.entries(VISUAL_HOST_CSP_DIRECTIVES)) {
            expect(name === 'frame-ancestors' || !values.includes("'self'")).toBe(true);
        }
        expect(directiveOf(VISUAL_HOST_CSP, 'form-action')).toEqual(["'none'"]);
        expect(directiveOf(VISUAL_HOST_CSP, 'base-uri')).toEqual(["'none'"]);
        expect(directiveOf(VISUAL_HOST_CSP, 'frame-ancestors')).toEqual(["'self'"]);
    });

    test('keeps the page on an opaque origin with exactly the rights of its frame', () => {
        expect(directiveOf(VISUAL_HOST_CSP, 'sandbox')).toEqual(['allow-scripts', 'allow-forms']);
        expect(VISUAL_HOST_CSP).not.toContain('allow-same-origin');
    });

    test('goes out as html that is never sniffed and is asked for again after a release', () => {
        expect(VISUAL_HOST_HEADERS).toEqual({
            'content-type': 'text/html; charset=utf-8',
            'content-security-policy': VISUAL_HOST_CSP,
            'x-content-type-options': 'nosniff',
            'referrer-policy': 'no-referrer',
            'cache-control': 'no-cache'
        });
    });
});
