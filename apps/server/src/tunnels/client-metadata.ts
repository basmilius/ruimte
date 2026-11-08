import { isIP } from 'node:net';
import { z } from 'zod';

export const METADATA_TIMEOUT_MS = 5_000;
export const METADATA_MAX_BYTES = 64 * 1024;

/* What every failure to identify a client says, so the answer tells a caller nothing about this machine's network. */
export const CLIENT_NOT_IDENTIFIED = 'The client could not be identified';

export class ClientMetadataError extends Error {
    constructor() {
        super(CLIENT_NOT_IDENTIFIED);
    }
}

const MetadataSchema = z.object({
    client_id: z.string(),
    client_name: z.string().trim().min(1).max(200),
    redirect_uris: z.array(z.string().max(2048)).min(1).max(20)
});

export interface ClientMetadata {
    clientId: string;
    clientName: string;
    redirectUris: string[];
}

/* The eight 16-bit groups of an IPv6 address, an embedded IPv4 tail included; null for a text that is none. */
function hextetsOf(address: string): number[] | null {
    let text = address;
    const tail = /(\d+)\.(\d+)\.(\d+)\.(\d+)$/.exec(text);

    if (tail !== null) {
        const [, a, b, c, d] = tail.map(Number) as [number, number, number, number, number];

        text = `${text.slice(0, tail.index)}${((a << 8) | b).toString(16)}:${((c << 8) | d).toString(16)}`;
    }

    const halves = text.split('::');

    if (halves.length > 2) {
        return null;
    }

    const head = halves[0] === '' ? [] : halves[0]!.split(':');
    const rest = halves.length === 2 ? (halves[1] === '' ? [] : halves[1]!.split(':')) : [];
    const missing = 8 - head.length - rest.length;

    if ((halves.length === 1 && missing !== 0) || missing < 0 || (halves.length === 2 && missing < 1)) {
        return null;
    }

    const groups = [...head, ...Array<string>(halves.length === 2 ? missing : 0).fill('0'), ...rest].map((group) => Number.parseInt(group, 16));

    return groups.length === 8 && groups.every((group) => Number.isInteger(group) && group >= 0 && group <= 0xffff) ? groups : null;
}

/*
 * Whether an address leads somewhere only this machine or its network can go: loopback, private, link-local, carrier-grade NAT,
 * unique-local, the unspecified address, the IPv4-compatible range `::/96` and the ones an IPv4 address hides in. A metadata
 * document is never fetched from one.
 */
export function isBlockedAddress(address: string): boolean {
    const plain = address.replace(/^\[|\]$/g, '').toLowerCase();

    if (isIP(plain) === 4) {
        const [first = 0, second = 0] = plain.split('.').map(Number);

        return (
            first === 0 ||
            first === 10 ||
            first === 127 ||
            (first === 100 && second >= 64 && second <= 127) ||
            (first === 169 && second === 254) ||
            (first === 172 && second >= 16 && second <= 31) ||
            (first === 192 && second === 168) ||
            (first === 192 && second === 0) ||
            first >= 224
        );
    }

    if (isIP(plain) === 6) {
        const groups = hextetsOf(plain);

        if (groups === null) {
            return true;
        }

        const [first = 0, second = 0] = groups;

        // ::/96 holds the unspecified address, the loopback and every IPv4-compatible address, whichever way it is written.
        return (
            groups.slice(0, 6).every((group) => group === 0) ||
            // An IPv4-mapped address, a NAT64 one and the 6to4 range lead wherever their IPv4 part does, so none is fetched.
            (groups.slice(0, 5).every((group) => group === 0) && groups[5] === 0xffff) ||
            (first === 0x64 && second === 0xff9b) ||
            first === 0x2002 ||
            // Unique-local fc00::/7 and link-local fe80::/10.
            (first & 0xfe00) === 0xfc00 ||
            (first & 0xffc0) === 0xfe80
        );
    }

    return true;
}

/* What a get hands back: the status, the content type and the body in pieces, so the reader can stop at the size cap. */
export interface MetadataResponse {
    status: number;
    contentType: string | null;
    body: AsyncIterable<Uint8Array>;
}

export interface MetadataPorts {
    /* Every address the name leads to. */
    resolve(hostname: string): Promise<string[]>;
    /*
     * Reads the document from exactly this address, and from no other: the connection is made to `address` while the name stays the
     * name of the TLS certificate and of the `Host` header. A second lookup here would let a name answer once with a public address
     * and once with a private one.
     */
    get(url: URL, address: string, signal: AbortSignal): Promise<MetadataResponse>;
}

async function boundedText(body: AsyncIterable<Uint8Array>): Promise<string> {
    const decoder = new TextDecoder();
    let text = '';
    let total = 0;

    for await (const chunk of body) {
        total += chunk.byteLength;

        if (total > METADATA_MAX_BYTES) {
            throw new ClientMetadataError();
        }

        text += decoder.decode(chunk, { stream: true });
    }

    return text + decoder.decode();
}

/*
 * Fetches the Client ID Metadata Document a client names itself with. The address must be an https URL on a public host: no
 * credentials in it, no IP literal in a private range, and no name that leads to one. The name is resolved once, every answer is
 * checked, and the document is read from the first address that was checked. A redirect is never followed, the answer has a size cap
 * and a short timeout, and the document has to name that same URL as its `client_id`. Whatever goes wrong, the error is the same.
 */
export async function fetchClientMetadata(clientId: string, ports: MetadataPorts): Promise<ClientMetadata> {
    try {
        return await read(clientId, ports);
    } catch {
        throw new ClientMetadataError();
    }
}

async function read(clientId: string, ports: MetadataPorts): Promise<ClientMetadata> {
    const url = new URL(clientId);

    if (url.protocol !== 'https:' || url.username !== '' || url.password !== '' || url.hash !== '' || url.pathname === '/') {
        throw new ClientMetadataError();
    }

    const hostname = url.hostname.replace(/^\[|\]$/g, '');
    const addresses = isIP(hostname) === 0 ? await ports.resolve(hostname) : [hostname];
    const address = addresses[0];

    if (address === undefined || addresses.some(isBlockedAddress)) {
        throw new ClientMetadataError();
    }

    const response = await ports.get(url, address, AbortSignal.timeout(METADATA_TIMEOUT_MS));

    if (response.status < 200 || response.status > 299 || !(response.contentType ?? '').includes('json')) {
        throw new ClientMetadataError();
    }

    const parsed = MetadataSchema.parse(JSON.parse(await boundedText(response.body)));

    if (parsed.client_id !== clientId) {
        throw new ClientMetadataError();
    }

    return { clientId, clientName: parsed.client_name, redirectUris: parsed.redirect_uris };
}

/* A redirect the metadata document lists exactly; https, or http on loopback for a client that runs on the person's own machine. */
export function allowedRedirect(redirect: string, metadata: ClientMetadata): boolean {
    if (!metadata.redirectUris.includes(redirect)) {
        return false;
    }

    try {
        const url = new URL(redirect);

        return url.protocol === 'https:' || (url.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname));
    } catch {
        return false;
    }
}
