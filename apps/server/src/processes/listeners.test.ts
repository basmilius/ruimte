import { expect, test } from 'bun:test';
import { parseListeners } from './listeners.ts';

test('lsof field output handles IPv4, IPv6, wildcard, multiple descriptors and processes', () => {
    expect(
        parseListeners('p12\nf9\ntIPv4\nn127.0.0.1:5173\nTST=LISTEN\nTQR=0\nf10\ntIPv6\nn*:3000\nTST=LISTEN\np13\nf4\ntIPv6\nn[::1]:8000\nTST=LISTEN\n')
    ).toEqual([
        { pid: 12, port: 5173, bindAddress: '127.0.0.1', host: '127.0.0.1' },
        { pid: 12, port: 3000, bindAddress: '*', host: '[::1]' },
        { pid: 13, port: 8000, bindAddress: '[::1]', host: '[::1]' }
    ]);
    expect(parseListeners('')).toEqual([]);
    expect(parseListeners('p12\nf9\ntIPv4\nn192.168.1.2:3000\nTST=LISTEN\n')).toEqual([{ pid: 12, port: 3000, bindAddress: '192.168.1.2', host: '127.0.0.1' }]);
});

test('malformed or incomplete lsof output cannot look like an empty successful scan', () => {
    for (const output of ['denied', 'p0\n', 'p12\n', 'p12\np13\n', 'p12\nf9\n', 'p12\nf9\ntIPv4\nn*:3000\n', 'p12\nf9\ntIPv4\nn*:99999\nTST=LISTEN\n']) {
        expect(() => parseListeners(output)).toThrow();
    }
});
