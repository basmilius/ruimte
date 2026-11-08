import { describe, expect, test } from 'bun:test';
import { allowedRedirect, ClientMetadataError, fetchClientMetadata, isBlockedAddress, METADATA_MAX_BYTES, type MetadataPorts } from './client-metadata.ts';

const URL_OF_CLIENT = 'https://client.example/oauth/meta.json';

function ports(
    document: unknown,
    options: { addresses?: string[]; status?: number; type?: string; body?: string } = {}
): MetadataPorts & { fetched: string[] } {
    const fetched: string[] = [];

    return {
        fetched,
        resolve: async () => options.addresses ?? ['93.184.216.34'],
        fetch: async (url) => {
            fetched.push(url);

            return new Response(options.body ?? JSON.stringify(document), {
                status: options.status ?? 200,
                headers: { 'content-type': options.type ?? 'application/json' }
            });
        }
    };
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
        '[::1]',
        'not an address'
    ])('%s is blocked', (address) => {
        expect(isBlockedAddress(address)).toBe(true);
    });

    test.each(['93.184.216.34', '8.8.8.8', '172.32.0.1', '2606:4700:4700::1111'])('%s is public', (address) => {
        expect(isBlockedAddress(address)).toBe(false);
    });
});

describe('the metadata document of a client', () => {
    test('is read from a public https address and names the client and its redirects', async () => {
        const answer = await fetchClientMetadata(URL_OF_CLIENT, ports(document));

        expect(answer).toEqual({ clientId: URL_OF_CLIENT, clientName: 'Hosted Claude', redirectUris: ['https://client.example/callback'] });
    });

    test('is never fetched from a private address, a name that leads to one or a literal one', async () => {
        for (const addresses of [['10.0.0.5'], ['93.184.216.34', '127.0.0.1'], ['::1']]) {
            const given = ports(document, { addresses });

            await expect(fetchClientMetadata(URL_OF_CLIENT, given)).rejects.toBeInstanceOf(ClientMetadataError);
            expect(given.fetched).toEqual([]);
        }

        for (const literal of [
            'https://127.0.0.1/meta.json',
            'https://169.254.169.254/latest/meta.json',
            'https://[::1]/meta.json',
            'https://10.0.0.1/m.json'
        ]) {
            const given = ports(document);

            await expect(fetchClientMetadata(literal, given)).rejects.toBeInstanceOf(ClientMetadataError);
            expect(given.fetched).toEqual([]);
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

    test('is refused when the client_id inside names another address', async () => {
        await expect(fetchClientMetadata(URL_OF_CLIENT, ports({ ...document, client_id: 'https://other.example/meta.json' }))).rejects.toBeInstanceOf(
            ClientMetadataError
        );
    });

    test('is refused past its size cap, for a failing answer and for a body that is no JSON', async () => {
        const huge = JSON.stringify({ ...document, padding: 'x'.repeat(METADATA_MAX_BYTES) });

        await expect(fetchClientMetadata(URL_OF_CLIENT, ports(null, { body: huge }))).rejects.toBeInstanceOf(ClientMetadataError);
        await expect(fetchClientMetadata(URL_OF_CLIENT, ports(document, { status: 500 }))).rejects.toBeInstanceOf(ClientMetadataError);
        await expect(fetchClientMetadata(URL_OF_CLIENT, ports(document, { type: 'text/html' }))).rejects.toBeInstanceOf(ClientMetadataError);
        await expect(fetchClientMetadata(URL_OF_CLIENT, ports(null, { body: '{nope' }))).rejects.toBeInstanceOf(ClientMetadataError);
    });

    test('does not follow a redirect', async () => {
        let init: RequestInit | undefined;

        await fetchClientMetadata(URL_OF_CLIENT, {
            resolve: async () => ['93.184.216.34'],
            fetch: async (_url, given) => {
                init = given;

                return new Response(JSON.stringify(document), { headers: { 'content-type': 'application/json' } });
            }
        });

        expect(init?.redirect).toBe('manual');
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
