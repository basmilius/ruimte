// Without `nodejs_compat` there is no Buffer, and every key, token and hash here travels as base64url.

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

// 32 random bytes, the size of every token, state and code the address book hands out.
export const randomToken = (): string => toBase64Url(crypto.getRandomValues(new Uint8Array(32)));

export const sha256 = async (text: string): Promise<string> => toBase64Url(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)));
