import { describe, expect, test } from 'bun:test';
import {
    allowedRedirect,
    CLIENT_NOT_IDENTIFIED,
    ClientMetadataError,
    fetchClientMetadata,
    isBlockedAddress,
    METADATA_MAX_BYTES,
    type MetadataPorts
} from './client-metadata.ts';

const URL_OF_CLIENT = 'https://client.example/oauth/meta.json';

interface Options {
    addresses?: string[];
    status?: number;
    type?: string;
    body?: string;
    /* The addresses the name leads to on each lookup, for a name that answers differently the second time. */
    lookups?: string[][];
}

async function* pieces(text: string): AsyncGenerator<Uint8Array> {
    const bytes = new TextEncoder().encode(text);

    for (let at = 0; at < bytes.length; at += 8192) {
        yield bytes.subarray(at, at + 8192);
    }
}

function ports(document: unknown, options: Options = {}): MetadataPorts & { got: Array<{ url: string; address: string }>; resolved: number } {
    const given = {
        got: [] as Array<{ url: string; address: string }>,
        resolved: 0,
        resolve: async () => {
            const answer = options.lookups?.[given.resolved] ?? options.addresses ?? ['93.184.216.34'];

            given.resolved += 1;

            return answer;
        },
        get: async (url: URL, address: string) => {
            given.got.push({ url: url.href, address });

            return {
                status: options.status ?? 200,
                contentType: options.type ?? 'application/json',
                body: pieces(options.body ?? JSON.stringify(document))
            };
        }
    };

    return given;
}

const document = { client_id: URL_OF_CLIENT, client_name: 'Hosted Claude', redirect_uris: ['https://client.example/callback'] };

describe('addresses that are not public', () => {
    test.each([
        '127.0.0.1',
        '10.1.2.3',
        '172.16.0.1',
        '172.31.255.255',
        '192.168.1.1',
        '169.254.169.254',
        '100.64.0.1',
        '0.0.0.0',
        '224.0.0.1',
        '::1',
        '::',
        'fe80::1',
        'fd12:3456::1',
        'fc00::1',
        '::ffff:127.0.0.1',
        '::ffff:10.0.0.1',
        '::ffff:7f00:1',
        '[::1]',
        'not an address',
        // ::/96, the IPv4-compatible range, in every spelling.
        '::7f00:1',
        '::127.0.0.1',
        '::a00:1',
        '::10.0.0.1',
        '::192.168.1.1',
        '::8.8.8.8',
        '0:0:0:0:0:0:7f00:1',
        '0:0:0:0:0:0:0:2',
        '2002:7f00:1::1'
    ])('%s is blocked', (address) => {
        expect(isBlockedAddress(address)).toBe(true);
    });

    test.each(['93.184.216.34', '8.8.8.8', '172.32.0.1', '2606:4700:4700::1111', '2a00:1450:4001:81b::200e', '1::1'])('%s is public', (address) => {
        expect(isBlockedAddress(address)).toBe(false);
    });
});

describe('the metadata document of a client', () => {
    test('is read from a public https address and names the client and its redirects', async () => {
        const answer = await fetchClientMetadata(URL_OF_CLIENT, ports(document));

        expect(answer).toEqual({ clientId: URL_OF_CLIENT, clientName: 'Hosted Claude', redirectUris: ['https://client.example/callback'] });
    });

    test('is read from the address that was checked, and the name is looked up once', async () => {
        // A name that answers a public address first and the metadata endpoint of a cloud provider the second time.
        const given = ports(document, { lookups: [['93.184.216.34'], ['169.254.169.254']] });

        await fetchClientMetadata(URL_OF_CLIENT, given);

        expect(given.resolved).toBe(1);
        expect(given.got).toEqual([{ url: URL_OF_CLIENT, address: '93.184.216.34' }]);
    });

    test('is never fetched from a private address, a name that leads to one or a literal one', async () => {
        for (const addresses of [['10.0.0.5'], ['93.184.216.34', '127.0.0.1'], ['::1'], ['::7f00:1'], []]) {
            const given = ports(document, { addresses });

            await expect(fetchClientMetadata(URL_OF_CLIENT, given)).rejects.toBeInstanceOf(ClientMetadataError);
            expect(given.got).toEqual([]);
        }

        for (const literal of [
            'https://127.0.0.1/meta.json',
            'https://169.254.169.254/latest/meta.json',
            'https://[::1]/meta.json',
            'https://[::7f00:1]/meta.json',
            'https://10.0.0.1/m.json'
        ]) {
            const given = ports(document);

            await expect(fetchClientMetadata(literal, given)).rejects.toBeInstanceOf(ClientMetadataError);
            expect(given.got).toEqual([]);
        }
    });

    test('is refused for anything but an https address with a path and no credentials', async () => {
        for (const address of [
            'http://client.example/meta.json',
            'https://client.example/',
            'https://user:pass@client.example/meta.json',
            'https://client.example/meta.json#frag',
            'ftp://client.example/m',
            'nonsense'
        ]) {
            await expect(fetchClientMetadata(address, ports(document))).rejects.toBeInstanceOf(ClientMetadataError);
        }
    });

    test('says the same thing about every way it can fail, so the answer shows nothing of the network', async () => {
        const huge = JSON.stringify({ ...document, padding: 'x'.repeat(METADATA_MAX_BYTES) });
        const failures: Array<Promise<unknown>> = [
            fetchClientMetadata(URL_OF_CLIENT, ports(document, { addresses: ['10.0.0.5'] })),
            fetchClientMetadata(URL_OF_CLIENT, ports(document, { addresses: [] })),
            fetchClientMetadata(URL_OF_CLIENT, ports(document, { status: 404 })),
            fetchClientMetadata(URL_OF_CLIENT, ports(document, { status: 500 })),
            fetchClientMetadata(URL_OF_CLIENT, ports(document, { type: 'text/html' })),
            fetchClientMetadata(URL_OF_CLIENT, ports(null, { body: '{nope' })),
            fetchClientMetadata(URL_OF_CLIENT, ports(null, { body: huge })),
            fetchClientMetadata(URL_OF_CLIENT, ports({ ...document, client_id: 'https://other.example/meta.json' })),
            fetchClientMetadata(URL_OF_CLIENT, ports({ client_id: URL_OF_CLIENT })),
            fetchClientMetadata('http://client.example/meta.json', ports(document)),
            fetchClientMetadata('nonsense', ports(document)),
            fetchClientMetadata(URL_OF_CLIENT, {
                resolve: async () => {
                    throw new Error('getaddrinfo ENOTFOUND client.example');
                },
                get: async () => ports(document).get(new URL(URL_OF_CLIENT), '1.1.1.1', AbortSignal.timeout(1))
            }),
            fetchClientMetadata(URL_OF_CLIENT, {
                resolve: async () => ['93.184.216.34'],
                get: async () => {
                    throw new Error('connect ECONNREFUSED 93.184.216.34:443');
                }
            })
        ];
        const messages = (await Promise.all(
            failures.map((failure) =>
                failure.then(
                    () => 'resolved',
                    (e: unknown) => (e as Error).message
                )
            )
        )) as string[];

        expect(new Set(messages)).toEqual(new Set([CLIENT_NOT_IDENTIFIED]));
    });

    test('is refused past its size cap', async () => {
        const huge = JSON.stringify({ ...document, padding: 'x'.repeat(METADATA_MAX_BYTES) });

        await expect(fetchClientMetadata(URL_OF_CLIENT, ports(null, { body: huge }))).rejects.toBeInstanceOf(ClientMetadataError);
    });

    test('is asked for under a short timeout', async () => {
        let signal: AbortSignal | undefined;

        await fetchClientMetadata(URL_OF_CLIENT, {
            resolve: async () => ['93.184.216.34'],
            get: async (_url, _address, given) => {
                signal = given;

                return { status: 200, contentType: 'application/json', body: pieces(JSON.stringify(document)) };
            }
        });

        expect(signal?.aborted).toBe(false);
    });
});

describe('a redirect', () => {
    const metadata = {
        clientId: URL_OF_CLIENT,
        clientName: 'Hosted Claude',
        redirectUris: ['https://client.example/callback', 'http://127.0.0.1:5000/cb', 'http://client.example/plain']
    };

    test('has to be listed exactly', () => {
        expect(allowedRedirect('https://client.example/callback', metadata)).toBe(true);
        expect(allowedRedirect('https://client.example/callback/', metadata)).toBe(false);
        expect(allowedRedirect('https://client.example/callback?x=1', metadata)).toBe(false);
        expect(allowedRedirect('https://evil.example/callback', metadata)).toBe(false);
    });

    test('is plain http only on loopback', () => {
        expect(allowedRedirect('http://127.0.0.1:5000/cb', metadata)).toBe(true);
        expect(allowedRedirect('http://client.example/plain', metadata)).toBe(false);
    });
});
