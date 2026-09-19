/*
 * base64url in WebCrypto alone, which is what a browser, a phone, Bun and a Worker all have and
 * `Buffer` is not. The client mints a PKCE verifier and the address book checks it, so the two have
 * to spell a token the same way down to the padding that is left off.
 */

export const toBase64Url = (bytes: ArrayBuffer | Uint8Array): string => {
    const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    let binary = '';
    for (const byte of view) {
        binary += String.fromCharCode(byte);
    }
    return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
};

export const fromBase64Url = (text: string): Uint8Array<ArrayBuffer> => {
    const padded = text.replaceAll('-', '+').replaceAll('_', '/') + '='.repeat((4 - (text.length % 4)) % 4);
    const binary = atob(padded);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
        bytes[i] = binary.charCodeAt(i);
    }
    return bytes;
};

/* Random bytes in base64url; 32 make a verifier of 43 characters, the shortest RFC 7636 allows. */
export const randomToken = (bytes = 32): string => toBase64Url(crypto.getRandomValues(new Uint8Array(bytes)));

export const sha256 = async (text: string): Promise<string> => toBase64Url(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)));
