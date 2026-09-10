import { describe, expect, test } from 'bun:test';
import { localFileUrl } from './file-url.ts';

describe('localFileUrl', () => {
    test('keeps a plain path as it is', () => {
        expect(localFileUrl('/Users/bas/site/index.html')).toBe('file:///Users/bas/site/index.html');
    });

    test('encodes what would otherwise end the path', () => {
        expect(localFileUrl('/Users/bas/my site/a b.html')).toBe('file:///Users/bas/my%20site/a%20b.html');
        expect(localFileUrl('/tmp/notes #2/page.html')).toBe('file:///tmp/notes%20%232/page.html');
        expect(localFileUrl('/tmp/what?/page.html')).toBe('file:///tmp/what%3F/page.html');
        expect(localFileUrl('/tmp/a&b/c%d.html')).toBe('file:///tmp/a%26b/c%25d.html');
    });

    test('encodes unicode as utf-8', () => {
        expect(localFileUrl('/Users/bas/café/ünïcode.html')).toBe('file:///Users/bas/caf%C3%A9/%C3%BCn%C3%AFcode.html');
        expect(localFileUrl('/Users/bas/文档/页.html')).toBe('file:///Users/bas/%E6%96%87%E6%A1%A3/%E9%A1%B5.html');
    });

    test('a windows path gets the root the url needs', () => {
        expect(localFileUrl('C:\\Users\\bas\\my site\\index.html')).toBe('file:///C%3A/Users/bas/my%20site/index.html');
    });
});
