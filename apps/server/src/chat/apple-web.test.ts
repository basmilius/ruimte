import { describe, expect, test } from 'bun:test';
import { appleTextResult } from './apple-network-tools.ts';
import { extractApplePage, isPublicWebAddress, limitAppleText, publicWebUrl } from './apple-web.ts';

describe('Apple web access', () => {
    test.each([
        '127.0.0.1',
        '10.0.0.1',
        '172.16.0.1',
        '192.168.1.1',
        '169.254.169.254',
        '100.64.0.1',
        '0.0.0.0',
        '224.0.0.1',
        '192.0.2.1',
        '::1',
        '::',
        'fe80::1',
        'fd00::1',
        '::ffff:127.0.0.1',
        '2001:db8::1',
        '2002:7f00:1::'
    ])('rejects private or reserved address %s', (address) => {
        expect(isPublicWebAddress(address)).toBe(false);
    });

    test.each(['1.1.1.1', '8.8.8.8', '2606:4700:4700::1111', '2001:4860:4860::8888'])('accepts public address %s', (address) => {
        expect(isPublicWebAddress(address)).toBe(true);
    });

    test.each([
        'file:///etc/passwd',
        'ftp://example.com/a',
        'http://user:secret@example.com',
        'http://localhost/a',
        'http://127.1',
        'http://0x7f000001',
        'http://2130706433',
        'http://[::ffff:127.0.0.1]'
    ])('rejects unsafe URL %s', (url) => {
        expect(() => publicWebUrl(url)).toThrow();
    });

    test('keeps public URLs and query text intact', () => {
        expect(publicWebUrl('https://example.com/search?q=a%20b').href).toBe('https://example.com/search?q=a%20b');
    });

    test('extracts page text without scripts, forms, navigation, or hidden content', () => {
        const result = extractApplePage({
            url: 'https://example.com',
            status: 200,
            contentType: 'text/html; charset=utf-8',
            text: '<html><head><title>Project &amp; notes</title><style>SECRETSTYLE</style></head><body><nav>Secret navigation</nav><main><h1>Project</h1><p>First &amp; second.</p><script>fetch("SECRET")</script><p hidden>Hidden</p><form>Form secret</form><p>Useful text.</p></main></body></html>'
        });
        expect(result.title).toBe('Project & notes');
        expect(result.text).toContain('First & second.');
        expect(result.text).toContain('Useful text.');
        expect(result.text).not.toMatch(/SECRET|Secret|Hidden|Form/);
    });

    test('rejects error responses and binary downloads', () => {
        expect(() => extractApplePage({ url: '', status: 403, contentType: 'text/html', text: 'Forbidden' })).toThrow('HTTP 403');
        expect(() => extractApplePage({ url: '', status: 200, contentType: 'image/png', text: 'binary' })).toThrow('Only text');
    });

    test('UTF-8 clipping never splits a character', () => {
        expect(limitAppleText('ab🙂cd', 5)).toEqual({ text: 'ab', truncated: true });
        expect(limitAppleText('ab🙂cd', 6)).toEqual({ text: 'ab🙂', truncated: true });
        expect(limitAppleText('abc', 3)).toEqual({ text: 'abc', truncated: false });
    });

    test('bounds JSON-escaped output and keeps metadata readable', () => {
        const output = appleTextResult({ url: 'https://example.com', title: 'Title' }, '"\\🙂\n'.repeat(2000));
        expect(Buffer.byteLength(output)).toBeLessThanOrEqual(6000);
        const parsed = JSON.parse(output);
        expect(parsed.url).toBe('https://example.com');
        expect(parsed.truncated).toBe(true);
        expect(parsed.content).not.toContain('�');
    });
});
