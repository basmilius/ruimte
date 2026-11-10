import { z } from 'zod';
import { fromBase64Url, toBase64Url } from './base64url.ts';
import { mapsTicketBytes, SIGNING_PURPOSES } from './signing.ts';

// How long a ticket admits requests to the maps service; a client asks for a new one a little before.
export const MAPS_TICKET_LIFETIME_MS = 3_600_000;

// The secret is 32 random bytes in base64url; anything shorter would make every ticket cheaper to forge.
const MAPS_SECRET_MIN_BYTES = 32;

const PATH_MAC_PREFIX = `${SIGNING_PURPOSES.mapsPath}\n`;

/*
 * `<subject>.<expiresAt>.<mac>`: the subject is a keyed digest of the account in base64url, the expiry is epoch
 * milliseconds and the mac is HMAC-SHA256 over `mapsTicketBytes`, so the maps service needs the secret and nothing else.
 */
export const MapsTicketSchema = z.object({
    ticket: z.string().regex(/^[A-Za-z0-9_-]{43}\.[1-9]\d{0,15}\.[A-Za-z0-9_-]{43}$/, 'Expected a maps ticket'),
    expiresAt: z.number().int().min(1),
    // The address book's clock when it issued the ticket, so a client with a clock of its own measures the lifetime from its arrival.
    issuedAt: z.number().int().min(0).optional()
});
export type MapsTicket = z.infer<typeof MapsTicketSchema>;

/* The key bytes of a secret, or null when it is not base64url or holds fewer than `MAPS_SECRET_MIN_BYTES` bytes. */
export function mapsSecretBytes(secret: string): Uint8Array<ArrayBuffer> | null {
    if (!/^[A-Za-z0-9_-]+$/.test(secret)) {
        return null;
    }
    try {
        const bytes = fromBase64Url(secret);
        return bytes.byteLength >= MAPS_SECRET_MIN_BYTES ? bytes : null;
    } catch {
        return null;
    }
}

async function hmacKey(bytes: Uint8Array<ArrayBuffer>, usage: 'sign' | 'verify') {
    return crypto.subtle.importKey('raw', bytes, { name: 'HMAC', hash: 'SHA-256' }, false, [usage]);
}

function secretOf(secret: string): Uint8Array<ArrayBuffer> {
    const bytes = mapsSecretBytes(secret);
    if (bytes === null) {
        throw new Error(`The maps secret must be base64url and at least ${MAPS_SECRET_MIN_BYTES} bytes`);
    }
    return bytes;
}

/*
 * The ticket subject of an account: a keyed digest, so nobody without the secret can compute the subject
 * of a known account id, and a key derived for this purpose alone, so it is no key of the mac.
 */
export async function mapsTicketSubject(secret: string, accountId: string): Promise<string> {
    return toBase64Url(
        await crypto.subtle.sign('HMAC', await derivedKey(secret, SIGNING_PURPOSES.mapsTicketSubject, 'sign'), new TextEncoder().encode(`account:${accountId}`))
    );
}

async function derivedKey(secret: string, purpose: string, usage: 'sign' | 'verify') {
    const derived = await crypto.subtle.sign('HMAC', await hmacKey(secretOf(secret), 'sign'), new TextEncoder().encode(purpose));

    return hmacKey(new Uint8Array(derived), usage);
}

/*
 * A mark over a piece of text, under a key derived for it alone. The maps service puts one on every
 * address it writes into a style, so it later serves only addresses it wrote itself.
 */
export async function signMapsPath(secret: string, text: string): Promise<string> {
    return toBase64Url(
        await crypto.subtle.sign('HMAC', await derivedKey(secret, SIGNING_PURPOSES.mapsPathKey, 'sign'), new TextEncoder().encode(`${PATH_MAC_PREFIX}${text}`))
    );
}

export async function verifyMapsPath(secret: string, text: string, mac: string): Promise<boolean> {
    if (mapsSecretBytes(secret) === null || !/^[A-Za-z0-9_-]{43}$/.test(mac)) {
        return false;
    }
    return crypto.subtle.verify(
        'HMAC',
        await derivedKey(secret, SIGNING_PURPOSES.mapsPathKey, 'verify'),
        fromBase64Url(mac),
        new TextEncoder().encode(`${PATH_MAC_PREFIX}${text}`)
    );
}

export async function signMapsTicket(secret: string, subject: string, expiresAt: number): Promise<MapsTicket> {
    const mac = await crypto.subtle.sign('HMAC', await hmacKey(secretOf(secret), 'sign'), new TextEncoder().encode(mapsTicketBytes(subject, expiresAt)));
    return { ticket: `${subject}.${expiresAt}.${toBase64Url(mac)}`, expiresAt };
}

/* The subject of a ticket the secret signed and that has not ended, or null for any other. */
export async function verifyMapsTicket(secret: string, ticket: string, now: number): Promise<{ subject: string; expiresAt: number } | null> {
    const bytes = mapsSecretBytes(secret);
    if (bytes === null || !MapsTicketSchema.shape.ticket.safeParse(ticket).success) {
        return null;
    }
    const [subject = '', expiry = '', mac = ''] = ticket.split('.');
    const expiresAt = Number(expiry);
    if (!Number.isSafeInteger(expiresAt) || expiresAt <= now) {
        return null;
    }
    const valid = await crypto.subtle.verify(
        'HMAC',
        await hmacKey(bytes, 'verify'),
        fromBase64Url(mac),
        new TextEncoder().encode(mapsTicketBytes(subject, expiresAt))
    );
    return valid ? { subject, expiresAt } : null;
}

// Where the maps service lives; the address book only issues the ticket it admits.
export const MAPS_URL = 'https://maps.ruimte.app';

export const MapsErrorCodeSchema = z.enum([
    // The service has no TomTom key or no ticket secret yet.
    'maps-unconfigured',
    'bad-ticket',
    'rate-limited',
    'not-found',
    'bad-request',
    // TomTom refused or failed: the key lacks the right, or the service is down.
    'upstream',
    'internal'
]);
export type MapsErrorCode = z.infer<typeof MapsErrorCodeSchema>;

export const MAPS_ERROR_STATUS: Readonly<Record<MapsErrorCode, number>> = {
    'maps-unconfigured': 503,
    'bad-ticket': 401,
    'rate-limited': 429,
    'not-found': 404,
    'bad-request': 400,
    upstream: 502,
    internal: 500
};

export const MapsErrorSchema = z.object({ error: z.object({ code: MapsErrorCodeSchema, message: z.string().max(512) }) });
