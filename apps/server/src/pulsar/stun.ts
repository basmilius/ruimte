import { createHash, createHmac, randomBytes } from 'node:crypto';

/*
 * The few STUN and TURN messages the reach check sends (RFC 8489, RFC 8656): a binding request, and
 * an allocation with long-term credentials that is released at once. Written for asking whether a
 * server answers, not for carrying media.
 */

const MAGIC_COOKIE = 0x2112a442;
export const HEADER_BYTES = 20;

export const STUN_METHOD = { binding: 0x0001, allocate: 0x0003, refresh: 0x0004 } as const;

const CLASS_SUCCESS = 0x0100;
const CLASS_ERROR = 0x0110;

export const STUN_ATTRIBUTE = {
    username: 0x0006,
    messageIntegrity: 0x0008,
    errorCode: 0x0009,
    lifetime: 0x000d,
    realm: 0x0014,
    nonce: 0x0015,
    requestedTransport: 0x0019
} as const;

// The protocol number of UDP, the one transport a TURN allocation is asked for here.
const UDP_PROTOCOL = 17;

export interface StunAttribute {
    type: number;
    value: Uint8Array;
}

export interface StunMessage {
    method: number;
    kind: 'request' | 'success' | 'error' | 'indication';
    transactionId: Uint8Array;
    attributes: StunAttribute[];
}

export function newTransactionId(): Uint8Array {
    return new Uint8Array(randomBytes(12));
}

function padded(length: number): number {
    return (length + 3) & ~3;
}

function encodeAttributes(attributes: readonly StunAttribute[]): Uint8Array {
    const size = attributes.reduce((total, attribute) => total + 4 + padded(attribute.value.length), 0);
    const bytes = new Uint8Array(size);
    const view = new DataView(bytes.buffer);
    let offset = 0;
    for (const attribute of attributes) {
        view.setUint16(offset, attribute.type);
        view.setUint16(offset + 2, attribute.value.length);
        bytes.set(attribute.value, offset + 4);
        offset += 4 + padded(attribute.value.length);
    }
    return bytes;
}

function header(type: number, length: number, transactionId: Uint8Array): Uint8Array {
    const bytes = new Uint8Array(HEADER_BYTES);
    const view = new DataView(bytes.buffer);
    view.setUint16(0, type);
    view.setUint16(2, length);
    view.setUint32(4, MAGIC_COOKIE);
    bytes.set(transactionId, 8);
    return bytes;
}

function concat(...parts: Uint8Array[]): Uint8Array {
    const bytes = new Uint8Array(parts.reduce((total, part) => total + part.length, 0));
    let offset = 0;
    for (const part of parts) {
        bytes.set(part, offset);
        offset += part.length;
    }
    return bytes;
}

/* A request, signed with MESSAGE-INTEGRITY when a key is given; the HMAC covers the header with the length that includes it. */
export function encodeRequest(method: number, transactionId: Uint8Array, attributes: readonly StunAttribute[], key?: Uint8Array): Uint8Array {
    const body = encodeAttributes(attributes);
    if (key === undefined) {
        return concat(header(method, body.length, transactionId), body);
    }
    const signed = concat(header(method, body.length + 24, transactionId), body);
    const integrity = createHmac('sha1', key).update(signed).digest();
    return concat(signed, encodeAttributes([{ type: STUN_ATTRIBUTE.messageIntegrity, value: new Uint8Array(integrity) }]));
}

/* The length a message that starts with these bytes has in all, or null while the header is not in yet; for a stream. */
export function messageLength(bytes: Uint8Array): number | null {
    if (bytes.length < HEADER_BYTES) {
        return null;
    }
    return HEADER_BYTES + new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint16(2);
}

/* Null for anything that is not a STUN message, which a socket shared with nothing else should never see. */
export function decodeMessage(bytes: Uint8Array): StunMessage | null {
    if (bytes.length < HEADER_BYTES) {
        return null;
    }
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const type = view.getUint16(0);
    const length = view.getUint16(2);
    if ((type & 0xc000) !== 0 || view.getUint32(4) !== MAGIC_COOKIE || HEADER_BYTES + length > bytes.length) {
        return null;
    }
    const classBits = type & 0x0110;
    const method = type & ~0x0110;
    const kind = classBits === 0 ? 'request' : classBits === CLASS_SUCCESS ? 'success' : classBits === CLASS_ERROR ? 'error' : 'indication';
    const attributes: StunAttribute[] = [];
    let offset = HEADER_BYTES;
    while (offset + 4 <= HEADER_BYTES + length) {
        const attributeType = view.getUint16(offset);
        const attributeLength = view.getUint16(offset + 2);
        if (offset + 4 + attributeLength > HEADER_BYTES + length) {
            return null;
        }
        attributes.push({ type: attributeType, value: bytes.slice(offset + 4, offset + 4 + attributeLength) });
        offset += 4 + padded(attributeLength);
    }
    return { method, kind, transactionId: bytes.slice(8, 20), attributes };
}

export function sameTransaction(left: Uint8Array, right: Uint8Array): boolean {
    return left.length === right.length && left.every((byte, i) => byte === right[i]);
}

export function attributeOf(message: StunMessage, type: number): Uint8Array | null {
    return message.attributes.find((attribute) => attribute.type === type)?.value ?? null;
}

/* The error code of an error response, 0 when it carries none. */
export function errorCodeOf(message: StunMessage): number {
    const value = attributeOf(message, STUN_ATTRIBUTE.errorCode);
    if (value === null || value.length < 4) {
        return 0;
    }
    return (value[2]! & 0x07) * 100 + value[3]!;
}

export function textAttribute(type: number, text: string): StunAttribute {
    return { type, value: new TextEncoder().encode(text) };
}

export function requestedTransportUdp(): StunAttribute {
    return { type: STUN_ATTRIBUTE.requestedTransport, value: new Uint8Array([UDP_PROTOCOL, 0, 0, 0]) };
}

export function lifetime(seconds: number): StunAttribute {
    const value = new Uint8Array(4);
    new DataView(value.buffer).setUint32(0, seconds);
    return { type: STUN_ATTRIBUTE.lifetime, value };
}

/* The long-term credential key (RFC 8489, 9.2.2): MD5 over `username:realm:password`. */
export function longTermKey(username: string, realm: string, password: string): Uint8Array {
    return new Uint8Array(createHash('md5').update(`${username}:${realm}:${password}`).digest());
}
