import { describe, expect, test } from 'bun:test';
import { ChunkedBody, framingOf, parseAbsoluteTarget, parseAuthority, parseRequestHead } from './http-head';
import { parseToShell, parseTunnelRequest } from './messages';
import { tunnelDestinationAllowed, tunnelDestinationAllowedFor } from './tunnel-policy';

describe('tunnelDestinationAllowed', () => {
    test('allows the loopback spellings on the shared port, and the documents a page makes itself', () => {
        for (const url of [
            'http://localhost:3000/',
            'http://127.0.0.1:3000/a?b=c',
            'http://[::1]:3000',
            'ws://localhost:3000/_hmr',
            'HTTP://LOCALHOST:3000/',
            'about:blank',
            'data:text/plain,hi',
            'blob:http://localhost:3000/uuid'
        ]) {
            expect(tunnelDestinationAllowed(url, 3000)).toBe(true);
        }
    });

    test('refuses another port, another host, a lookalike, another scheme and credentials in the address', () => {
        for (const url of [
            'http://localhost:3001/',
            'http://localhost/',
            'http://example.com:3000/',
            'http://127.1:3000/',
            'http://0x7f.0.0.1:3000/',
            'http://localhost.example.com:3000/',
            'http://localhost:3000@example.com/',
            'https://localhost:3000/',
            'wss://localhost:3000/',
            'file:///etc/passwd',
            'ftp://localhost:3000/'
        ]) {
            expect(tunnelDestinationAllowed(url, 3000)).toBe(false);
        }
    });

    test('lets a page without the window that made its tunnel load only the blank document', () => {
        expect(tunnelDestinationAllowedFor(false, 'about:blank', 3000)).toBe(true);
        expect(tunnelDestinationAllowedFor(false, 'http://localhost:3000/', 3000)).toBe(false);
        expect(tunnelDestinationAllowedFor(true, 'http://localhost:3000/', 3000)).toBe(true);
    });
});

describe('parsing', () => {
    test('reads an authority only from the fixed spellings', () => {
        expect(parseAuthority('localhost:3000')).toEqual({ host: 'localhost', port: 3000, text: 'localhost:3000' });
        expect(parseAuthority('[::1]')).toEqual({ host: '[::1]', port: 80, text: '[::1]' });
        expect(parseAuthority('localhost:0')).toBeNull();
        expect(parseAuthority('localhost:70000')).toBeNull();
        expect(parseAuthority('::1:3000')).toBeNull();
    });

    test('turns an absolute target into an origin-form path', () => {
        expect(parseAbsoluteTarget('http://localhost:3000')?.path).toBe('/');
        expect(parseAbsoluteTarget('http://localhost:3000?x=1')?.path).toBe('/?x=1');
        expect(parseAbsoluteTarget('http://localhost:3000/a#frag')).toBeNull();
        expect(parseAbsoluteTarget('http://localhost:3000@evil.test/')).toBeNull();
    });

    test('refuses a head that folds a line, puts a space before a colon or has a bare line feed', () => {
        for (const head of [
            'GET http://localhost:3000/ HTTP/1.1\r\nA: b\r\n c\r\n\r\n',
            'GET http://localhost:3000/ HTTP/1.1\r\nA : b\r\n\r\n',
            'GET http://localhost:3000/ HTTP/1.1\r\nA: b\nC: d\r\n\r\n',
            'GET http://localhost:3000/ HTTP/2\r\n\r\n'
        ]) {
            expect(parseRequestHead(Buffer.from(head)).kind).toBe('bad');
        }
    });

    test('refuses a head past its bound and waits for the rest of a short one', () => {
        expect(parseRequestHead(Buffer.from('GET http://localhost:3000/ HTTP/1.1\r\n')).kind).toBe('need-more');
        expect(parseRequestHead(Buffer.alloc(20_000, 0x61))).toMatchObject({ kind: 'bad', status: 431 });
    });

    test('decides the body framing and refuses two lengths', () => {
        const headers = (...lines: string[]) => lines.map((line) => line.split(': ') as [string, string]);

        expect(framingOf(headers())).toEqual({ kind: 'none' });
        expect(framingOf(headers('Content-Length: 12'))).toEqual({ kind: 'length', bytes: 12 });
        expect(framingOf(headers('Transfer-Encoding: Chunked'))).toEqual({ kind: 'chunked' });
        expect(framingOf(headers('Content-Length: 1', 'Content-Length: 2')).kind).toBe('bad');
        expect(framingOf(headers('Content-Length: 1', 'Transfer-Encoding: chunked')).kind).toBe('bad');
        expect(framingOf(headers('Transfer-Encoding: gzip, chunked')).kind).toBe('bad');
        expect(framingOf(headers('Content-Length: -1')).kind).toBe('bad');
    });

    test('follows chunks across any split of the bytes', () => {
        const body = Buffer.from('3;ext=1\r\nabc\r\n10\r\n0123456789abcdef\r\n0\r\nT: v\r\n\r\nNEXT');

        for (let cut = 1; cut < body.length; cut += 1) {
            const chunked = new ChunkedBody();
            const used = chunked.feed(body.subarray(0, cut)) + chunked.feed(body.subarray(cut));

            expect(chunked.error).toBeNull();
            expect(chunked.done).toBe(true);
            expect(body.subarray(used).toString()).toBe('NEXT');
        }
    });
});

describe('messages from the page', () => {
    test('reads a request for a tunnel and nothing more', () => {
        expect(parseTunnelRequest({ endpointId: 'mac', grantId: 'g', port: 3000, extra: 1 })).toEqual({ endpointId: 'mac', grantId: 'g', port: 3000 });
        expect(parseTunnelRequest({ endpointId: 'mac', grantId: 'g', port: 0 })).toBeNull();
        expect(parseTunnelRequest({ endpointId: '', grantId: 'g', port: 3000 })).toBeNull();
        expect(parseTunnelRequest(null)).toBeNull();
    });

    test('drops a message that is not one of the four', () => {
        expect(parseToShell({ kind: 'flushed', id: 't', stream: 1, bytes: 5 })).toEqual({ kind: 'flushed', id: 't', stream: 1, bytes: 5 });
        expect(parseToShell({ kind: 'flushed', id: 't', stream: 1, bytes: -5 })).toBeNull();
        expect(parseToShell({ kind: 'data', id: 't', stream: 1, data: 'text' })).toBeNull();
        expect(parseToShell({ kind: 'data', id: 't', stream: 1, data: new Uint8Array(0) })).toBeNull();
        expect(parseToShell({ kind: 'write', id: 't', stream: 1 })).toBeNull();
        expect(parseToShell({ kind: 'end', id: 't', stream: 0, reason: null })).toBeNull();
    });
});
