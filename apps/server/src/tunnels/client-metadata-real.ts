import { lookup } from 'node:dns/promises';
import https from 'node:https';
import { isIP } from 'node:net';
import type { MetadataPorts } from './client-metadata.ts';

type LookupCallback = (error: Error | null, address: string | Array<{ address: string; family: number }>, family?: number) => void;

/*
 * Connects to `address` and nowhere else. `lookup` is the only place a name is turned into an address, and it answers with the one that
 * was checked; `servername` and the `Host` header keep the name, so the certificate is judged against the client's own hostname.
 * Bun and Node both call `lookup` with `all` set or not, so it answers either way. `tls` is for a test with a certificate of its own.
 */
export function pinnedGet(tls: { ca?: string | Buffer } = {}): MetadataPorts['get'] {
    return (url, address, signal) =>
        new Promise((resolve, reject) => {
            const hostname = url.hostname.replace(/^\[|\]$/g, '');
            const family = isIP(address);
            const request = https.request(
                {
                    host: hostname,
                    port: url.port === '' ? 443 : Number(url.port),
                    path: `${url.pathname}${url.search}`,
                    method: 'GET',
                    headers: { host: url.host, accept: 'application/json' },
                    servername: isIP(hostname) === 0 ? hostname : undefined,
                    lookup: ((_host: string, options: { all?: boolean }, callback: LookupCallback) =>
                        options.all === true ? callback(null, [{ address, family }]) : callback(null, address, family)) as never,
                    signal,
                    ...tls
                },
                (response) => resolve({ status: response.statusCode ?? 0, contentType: response.headers['content-type'] ?? null, body: response })
            );

            request.on('error', reject);
            request.end();
        });
}

export function realMetadataPorts(): MetadataPorts {
    return {
        resolve: async (hostname) => (await lookup(hostname, { all: true })).map((entry) => entry.address),
        get: pinnedGet()
    };
}
