import type { BytesReadHeader, BytesReadPayload } from '@ruimte/contracts';
import type { Transport } from './transport';

export function decodeBase64(data: string): Uint8Array<ArrayBuffer> {
    const binary = atob(data);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) {
        bytes[i] = binary.charCodeAt(i);
    }
    return bytes;
}

export interface BytesPiece extends BytesReadHeader {
    bytes: Uint8Array<ArrayBuffer>;
}

/* A piece as a binary reply where the transport reads those, and as base64 in JSON everywhere else. */
export async function readPiece(transport: Pick<Transport, 'request' | 'readBytes'>, payload: BytesReadPayload): Promise<BytesPiece> {
    if (transport.readBytes) {
        return transport.readBytes(payload);
    }
    const { data, ...header } = await transport.request('bytes.read', payload);
    return { ...header, bytes: decodeBase64(data) };
}
