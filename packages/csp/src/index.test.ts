import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { cspString } from './index.ts';

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
