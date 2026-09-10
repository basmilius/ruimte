import { describe, expect, test } from 'bun:test';
import { prettyUrl } from '@/browser/pretty-url';

describe('prettyUrl', () => {
    test('drops the scheme of an https address', () => {
        expect(prettyUrl('https://bas.dev/over?test=1')).toBe('bas.dev/over?test=1');
        expect(prettyUrl('https://bas.dev/a/b#top')).toBe('bas.dev/a/b#top');
    });

    test('drops the slash of a bare origin only', () => {
        expect(prettyUrl('https://bas.dev/')).toBe('bas.dev');
        expect(prettyUrl('https://bas.dev')).toBe('bas.dev');
        expect(prettyUrl('https://bas.dev/over/')).toBe('bas.dev/over/');
        expect(prettyUrl('https://bas.dev/?test=1')).toBe('bas.dev/?test=1');
    });

    test('keeps a port and a subdomain', () => {
        expect(prettyUrl('https://docs.bas.dev:8443/')).toBe('docs.bas.dev:8443');
    });

    test('keeps every scheme that says something', () => {
        expect(prettyUrl('http://localhost:5173/')).toBe('http://localhost:5173/');
        expect(prettyUrl('file:///Users/bas/index.html')).toBe('file:///Users/bas/index.html');
        expect(prettyUrl('about:blank')).toBe('about:blank');
        expect(prettyUrl('https://')).toBe('https://');
        expect(prettyUrl('')).toBe('');
    });
});
