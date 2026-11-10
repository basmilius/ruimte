import { toBase64Url } from './base64url.ts';
import { localSecretChannelMessage } from './signing.ts';

/*
 * HMAC-SHA256 under a machine's local secret, in base64url. WebCrypto is what the daemon, the desktop
 * shell and the page all have, so each computes the same bytes and the secret itself never travels.
 */
export async function localSecretMac(secret: string, message: string): Promise<string> {
    const encoder = new TextEncoder();
    const key = await crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    return toBase64Url(await crypto.subtle.sign('HMAC', key, encoder.encode(message)));
}

/* What a client on the daemon's own machine sends in place of a key signature, over the channel it was challenged on. */
export function localChannelProof(secret: string, daemonId: string, challenge: string, binding: string): Promise<string> {
    return localSecretMac(secret, localSecretChannelMessage(daemonId, challenge, binding));
}
