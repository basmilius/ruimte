import { isIP } from 'node:net';
import { z } from 'zod';

export const METADATA_TIMEOUT_MS = 5_000;
export const METADATA_MAX_BYTES = 64 * 1024;

export class ClientMetadataError extends Error {}

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

/*
 * Whether an address leads somewhere only this machine or its network can go: loopback, private, link-local, carrier-grade NAT,
 * unique-local, the unspecified address and the ones an IPv4 address hides in. A metadata document is never fetched from one.
 */
export function isBlockedAddress(address: string): boolean {
    const plain = address.replace(/^\[|\]$/g, '').toLowerCase();
    const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(plain);

    if (mapped !== null) {
        return isBlockedAddress(mapped[1]!);
    }

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
        return (
            plain === '::' || plain === '::1' || /^f[cd]/.test(plain) || /^fe[89ab]/.test(plain) || plain.startsWith('64:ff9b:') || plain.startsWith('::ffff:')
        );
    }

    return true;
}

export interface MetadataPorts {
    /* Every address the name leads to. */
    resolve(hostname: string): Promise<string[]>;
    fetch(url: string, init: RequestInit): Promise<Response>;
}

async function boundedText(response: Response): Promise<string> {
    const reader = response.body?.getReader();

    if (reader === undefined) {
        return '';
    }

    const decoder = new TextDecoder();
    let text = '';
    let total = 0;

    for (let chunk = await reader.read(); !chunk.done; chunk = await reader.read()) {
        total += chunk.value.byteLength;

        if (total > METADATA_MAX_BYTES) {
            void reader.cancel();

            throw new ClientMetadataError('The client metadata document is larger than 64 KiB');
        }

        text += decoder.decode(chunk.value, { stream: true });
    }

    return text + decoder.decode();
}

/*
 * Fetches the Client ID Metadata Document a client names itself with. The address must be an https URL on a public host: no
 * credentials in it, no IP literal in a private range, and no name that leads to one. A redirect is never followed, the answer
 * has a size cap and a short timeout, and the document has to name that same URL as its `client_id`.
 */
export async function fetchClientMetadata(clientId: string, ports: MetadataPorts): Promise<ClientMetadata> {
    let url: URL;

    try {
        url = new URL(clientId);
    } catch {
        throw new ClientMetadataError('client_id is no address');
    }

    if (url.protocol !== 'https:' || url.username !== '' || url.password !== '' || url.hash !== '' || url.pathname === '/') {
        throw new ClientMetadataError('client_id has to be an https address with a path, and no credentials or fragment');
    }

    const hostname = url.hostname.replace(/^\[|\]$/g, '');
    const addresses = isIP(hostname) === 0 ? await ports.resolve(hostname).catch(() => []) : [hostname];

    if (addresses.length === 0 || addresses.some(isBlockedAddress)) {
        throw new ClientMetadataError('client_id leads to an address that is not public');
    }

    let response: Response;

    try {
        response = await ports.fetch(url.href, {
            redirect: 'manual',
            signal: AbortSignal.timeout(METADATA_TIMEOUT_MS),
            headers: { accept: 'application/json' }
        });
    } catch {
        throw new ClientMetadataError('The client metadata document could not be fetched');
    }

    if (!response.ok || !(response.headers.get('content-type') ?? '').includes('json')) {
        throw new ClientMetadataError('The client metadata document is not JSON');
    }

    let parsed: z.infer<typeof MetadataSchema>;

    try {
        parsed = MetadataSchema.parse(JSON.parse(await boundedText(response)));
    } catch (e) {
        throw e instanceof ClientMetadataError ? e : new ClientMetadataError('The client metadata document does not say who the client is');
    }

    if (parsed.client_id !== clientId) {
        throw new ClientMetadataError('The client metadata document names another client_id');
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
