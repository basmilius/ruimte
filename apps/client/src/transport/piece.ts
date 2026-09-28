import type { BytesReadHeader, BytesReadPayload } from '@ruimte/contracts';
import type { Transport } from './transport';

/*
 * What a URL on this page's origin may claim to be. Anything a browser would run when it is opened
 * (HTML, XML, JavaScript) is typed as a download instead. An SVG keeps its type, because an `<img>`
 * does not draw one without it and runs nothing inside it.
 */
const DRAWABLE = /^(image\/(png|jpeg|gif|webp|avif|heic|heif|bmp|x-icon|tiff|svg\+xml)|(video|audio)\/[\w.+-]+|application\/pdf|text\/plain)$/;

export const blobTypeFor = (mime: string): string => (DRAWABLE.test(mime) ? mime : 'application/octet-stream');

export const decodeBase64 = (data: string): Uint8Array<ArrayBuffer> => {
    const binary = atob(data);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) {
        bytes[i] = binary.charCodeAt(i);
    }
    return bytes;
};

/* A piece of a resource with its bytes as they are, however the machine sent them. */
export interface BytesPiece extends BytesReadHeader {
    bytes: Uint8Array<ArrayBuffer>;
}

/* A piece as a binary reply where the transport reads those, and as base64 in JSON everywhere else. */
export const readPiece = async (transport: Pick<Transport, 'request' | 'readBytes'>, payload: BytesReadPayload): Promise<BytesPiece> => {
    if (transport.readBytes) {
        return transport.readBytes(payload);
    }
    const { data, ...header } = await transport.request('bytes.read', payload);
    return { ...header, bytes: decodeBase64(data) };
};
