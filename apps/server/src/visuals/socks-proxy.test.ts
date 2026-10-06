import { describe, expect, test } from 'bun:test';
import { isLocalAddress } from './local-address.ts';
import { greetingReply, parseGreeting, parseRequest, permittedAddresses, SOCKS_REPLY, socksReply, type SocksDeps, type SocksRequest } from './socks-proxy.ts';

function bytes(...values: number[]): Uint8Array {
    return Uint8Array.from(values);
}

function domainRequest(host: string, port: number, command = 0x01): Uint8Array {
    const name = new TextEncoder().encode(host);
    return bytes(5, command, 0, 3, name.length, ...name, port >> 8, port & 0xff);
}

function deps(names: Record<string, string[]>): SocksDeps & { asked: string[] } {
    const asked: string[] = [];
    return {
        asked,
        resolve: async (host) => {
            asked.push(host);
            const found = names[host];
            if (found === undefined) {
                throw new Error(`ENOTFOUND ${host}`);
            }
            return found;
        },
        isLocal: (address) => isLocalAddress(address, ['203.0.113.50'])
    };
}

describe('the greeting', () => {
    test('waits for the whole method list', () => {
        expect(parseGreeting(bytes())).toEqual({ status: 'more' });
        expect(parseGreeting(bytes(5))).toEqual({ status: 'more' });
        expect(parseGreeting(bytes(5, 2, 0))).toEqual({ status: 'more' });
    });

    test('takes a client that offers no authentication, among other methods', () => {
        expect(parseGreeting(bytes(5, 2, 2, 0))).toEqual({ status: 'done', value: { noAuthentication: true }, length: 4 });
        expect(parseGreeting(bytes(5, 1, 2))).toEqual({ status: 'done', value: { noAuthentication: false }, length: 3 });
    });

    test('closes on another version without a reply', () => {
        expect(parseGreeting(bytes(4, 1, 0))).toEqual({ status: 'bad', reply: null });
    });

    test('answers the method it picked, or that none is acceptable', () => {
        expect([...greetingReply(true)]).toEqual([5, 0]);
        expect([...greetingReply(false)]).toEqual([5, 0xff]);
    });
});

describe('the request', () => {
    test('reads a CONNECT to an IPv4 address', () => {
        expect(parseRequest(bytes(5, 1, 0, 1, 127, 0, 0, 1, 0x10, 0x82))).toEqual({
            status: 'done',
            value: { type: 'ipv4', host: '127.0.0.1', port: 4226 },
            length: 10
        });
    });

    test('reads a CONNECT to an IPv6 address', () => {
        const address = [0x20, 0x01, 0x0d, 0xb8, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1];
        expect(parseRequest(bytes(5, 1, 0, 4, ...address, 1, 187))).toEqual({
            status: 'done',
            value: { type: 'ipv6', host: '2001:db8:0:0:0:0:0:1', port: 443 },
            length: 22
        });
    });

    test('reads a CONNECT to a name and leaves what follows it', () => {
        const request = domainRequest('cdn.example.com', 443);
        expect(parseRequest(bytes(...request, 9, 9))).toEqual({
            status: 'done',
            value: { type: 'domain', host: 'cdn.example.com', port: 443 },
            length: request.length
        });
    });

    test('waits until the address and the port are in', () => {
        const request = domainRequest('cdn.example.com', 443);
        for (let size = 0; size < request.length; size++) {
            expect(parseRequest(request.subarray(0, size)).status).toBe('more');
        }
        expect(parseRequest(bytes(5, 1, 0, 1, 1, 2, 3)).status).toBe('more');
    });

    test('refuses BIND and UDP ASSOCIATE', () => {
        expect(parseRequest(bytes(5, 2, 0, 1))).toEqual({ status: 'bad', reply: SOCKS_REPLY.commandNotSupported });
        expect(parseRequest(domainRequest('example.com', 53, 3))).toEqual({ status: 'bad', reply: SOCKS_REPLY.commandNotSupported });
    });

    test('refuses an address type it does not know, and an empty name', () => {
        expect(parseRequest(bytes(5, 1, 0, 9, 1, 2))).toEqual({ status: 'bad', reply: SOCKS_REPLY.addressNotSupported });
        expect(parseRequest(bytes(5, 1, 0, 3, 0, 0, 80))).toEqual({ status: 'bad', reply: SOCKS_REPLY.generalFailure });
        expect(parseRequest(bytes(4, 1, 0, 1))).toEqual({ status: 'bad', reply: null });
    });

    test('replies with its code and no bound address', () => {
        expect([...socksReply(SOCKS_REPLY.succeeded)]).toEqual([5, 0, 0, 1, 0, 0, 0, 0, 0, 0]);
        expect([...socksReply(SOCKS_REPLY.notAllowed)]).toEqual([5, 2, 0, 1, 0, 0, 0, 0, 0, 0]);
    });
});

describe('where a request may go', () => {
    const names = {
        'cdn.example.com': ['93.184.216.34', '2606:2800:220:1::1'],
        localhost: ['::1', '127.0.0.1'],
        'rebind.example.com': ['93.184.216.34', '192.168.1.20'],
        'own.example.com': ['203.0.113.50'],
        'mapped.example.com': ['::ffff:10.0.0.8'],
        'empty.example.com': []
    };

    async function decide(request: SocksRequest): Promise<{ addresses: string[] } | { reply: number }> {
        return permittedAddresses(request, deps(names));
    }

    test('a public name goes to exactly the addresses it was checked at', async () => {
        expect(await decide({ type: 'domain', host: 'cdn.example.com', port: 443 })).toEqual({ addresses: ['93.184.216.34', '2606:2800:220:1::1'] });
    });

    test('a name with any local address is refused whole', async () => {
        for (const host of ['localhost', 'rebind.example.com', 'own.example.com', 'mapped.example.com']) {
            expect(await decide({ type: 'domain', host, port: 80 })).toEqual({ reply: SOCKS_REPLY.notAllowed });
        }
    });

    test('a literal address is checked without asking the resolver, also when sent as a name', async () => {
        const resolver = deps(names);
        expect(await permittedAddresses({ type: 'domain', host: '127.0.0.1', port: 4210 }, resolver)).toEqual({ reply: SOCKS_REPLY.notAllowed });
        expect(await permittedAddresses({ type: 'ipv4', host: '10.0.0.1', port: 80 }, resolver)).toEqual({ reply: SOCKS_REPLY.notAllowed });
        expect(await permittedAddresses({ type: 'ipv6', host: '0:0:0:0:0:0:0:1', port: 80 }, resolver)).toEqual({ reply: SOCKS_REPLY.notAllowed });
        expect(await permittedAddresses({ type: 'ipv4', host: '93.184.216.34', port: 443 }, resolver)).toEqual({ addresses: ['93.184.216.34'] });
        expect(resolver.asked).toEqual([]);
    });

    test('a name that does not resolve, or to nothing, is unreachable', async () => {
        expect(await decide({ type: 'domain', host: 'nowhere.example.com', port: 443 })).toEqual({ reply: SOCKS_REPLY.hostUnreachable });
        expect(await decide({ type: 'domain', host: 'empty.example.com', port: 443 })).toEqual({ reply: SOCKS_REPLY.hostUnreachable });
    });

    test('port zero goes nowhere', async () => {
        expect(await decide({ type: 'ipv4', host: '93.184.216.34', port: 0 })).toEqual({ reply: SOCKS_REPLY.notAllowed });
    });
});
