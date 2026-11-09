import { createPublicKey, generateKeyPairSync, sign, verify } from 'node:crypto';

/* A WebSocket a test drives by hand: `parse` turns each frame the code sent into what the test reads from `sent`. */
export class FakeSocket<Sent = string> {
    readonly sent: Sent[] = [];
    closed = false;
    onopen: (() => void) | null = null;
    onmessage: ((message: { data: string }) => void) | null = null;
    onclose: (() => void) | null = null;
    onerror: (() => void) | null = null;

    readonly #parse: (frame: string) => Sent;

    constructor(parse: (frame: string) => Sent = (frame) => frame as Sent) {
        this.#parse = parse;
    }

    send(frame: string): void {
        this.sent.push(this.#parse(frame));
    }

    close(): void {
        this.closed = true;
    }

    deliver(frame: unknown): void {
        this.onmessage?.({ data: JSON.stringify(frame) });
    }

    event(event: string, payload: unknown): void {
        this.deliver({ type: 'event', event, payload });
    }
}

export function newKey() {
    const pair = generateKeyPairSync('ed25519');
    const publicKey = (pair.publicKey.export({ format: 'jwk' }) as { x: string }).x;

    return { publicKey, sign: (message: string) => sign(null, Buffer.from(message), pair.privateKey).toString('base64url') };
}

export async function verifies(publicKey: string, message: string, signature: string): Promise<boolean> {
    return verify(
        null,
        Buffer.from(message),
        createPublicKey({ key: { kty: 'OKP', crv: 'Ed25519', x: publicKey }, format: 'jwk' }),
        Buffer.from(signature, 'base64url')
    );
}
