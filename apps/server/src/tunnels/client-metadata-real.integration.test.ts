import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pinnedGet } from './client-metadata-real.ts';
import { fetchClientMetadata, METADATA_MAX_BYTES } from './client-metadata.ts';

/*
 * On real sockets and a real TLS handshake: a name that resolves to nothing is reached through the address that was checked, the
 * certificate is judged against the name, and a second lookup never happens.
 */

const NAME = 'pinned.test';
let folder: string;
let cert: string;
let key: string;
let server: ReturnType<typeof Bun.serve>;
const seen: { host: string | null } = { host: null };
let document: unknown;

beforeAll(async () => {
    folder = await mkdtemp(join(tmpdir(), 'ruimte-pinned-'));

    const made = Bun.spawn(
        [
            'openssl',
            'req',
            '-x509',
            '-newkey',
            'rsa:2048',
            '-nodes',
            '-keyout',
            join(folder, 'key.pem'),
            '-out',
            join(folder, 'cert.pem'),
            '-days',
            '2',
            '-subj',
            `/CN=${NAME}`,
            '-addext',
            `subjectAltName=DNS:${NAME}`
        ],
        { stdout: 'ignore', stderr: 'ignore' }
    );

    expect(await made.exited).toBe(0);
    cert = await readFile(join(folder, 'cert.pem'), 'utf8');
    key = await readFile(join(folder, 'key.pem'), 'utf8');
    server = Bun.serve({
        hostname: '127.0.0.1',
        port: 0,
        tls: { cert, key },
        fetch: (request) => {
            seen.host = request.headers.get('host');

            return new Response(JSON.stringify(document), { headers: { 'content-type': 'application/json' } });
        }
    });
});

afterAll(async () => {
    void server.stop(true);
    await rm(folder, { recursive: true, force: true });
});

function url(name = NAME, path = '/meta.json'): string {
    return `https://${name}:${server.port}${path}`;
}

describe('the pinned get', () => {
    test('reads from the address it was given while the name stays the name of the certificate and of Host', async () => {
        document = { client_id: url(), client_name: 'Pinned', redirect_uris: ['https://client.example/cb'] };

        // The name resolves to nothing: only the pinned address can have been used.
        const metadata = await fetchClientMetadata(url(), {
            resolve: async () => ['93.184.216.34'],
            get: (target, _checked, signal) => pinnedGet({ ca: cert })(target, '127.0.0.1', signal)
        });

        expect(metadata.clientName).toBe('Pinned');
        expect(seen.host).toBe(`${NAME}:${server.port}`);
    });

    test('refuses a certificate that is not for the name', async () => {
        document = {};
        // The same server, reached under another name: the handshake fails and the fetch says the usual sentence.
        const other = url('other.test');

        await expect(
            fetchClientMetadata(other, {
                resolve: async () => ['93.184.216.34'],
                get: (target, _checked, signal) => pinnedGet({ ca: cert })(target, '127.0.0.1', signal)
            })
        ).rejects.toThrow('The client could not be identified');
    });

    test('never resolves the name a second time', async () => {
        document = { client_id: url(), client_name: 'Pinned', redirect_uris: ['https://client.example/cb'] };

        let lookups = 0;

        await fetchClientMetadata(url(), {
            resolve: async () => {
                lookups += 1;

                return ['93.184.216.34'];
            },
            get: (target, _checked, signal) => pinnedGet({ ca: cert })(target, '127.0.0.1', signal)
        });

        expect(lookups).toBe(1);
    });

    test('stops reading at the size cap', async () => {
        document = { client_id: url(), client_name: 'Pinned', redirect_uris: ['https://client.example/cb'], padding: 'x'.repeat(METADATA_MAX_BYTES) };

        await expect(
            fetchClientMetadata(url(), {
                resolve: async () => ['93.184.216.34'],
                get: (target, _checked, signal) => pinnedGet({ ca: cert })(target, '127.0.0.1', signal)
            })
        ).rejects.toThrow('The client could not be identified');
    });
});
