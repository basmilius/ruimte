import { describe, expect, test } from 'bun:test';
import { createHmac } from 'node:crypto';
import {
    HEADER_BYTES,
    STUN_ATTRIBUTE,
    STUN_METHOD,
    attributeOf,
    decodeMessage,
    encodeRequest,
    errorCodeOf,
    longTermKey,
    messageLength,
    requestedTransportUdp,
    textAttribute
} from './stun.ts';

function hex(text: string): Uint8Array {
    return new Uint8Array(Buffer.from(text.replace(/\s+/g, ''), 'hex'));
}

const TRANSACTION = hex('b7e7a701bc34d686fa87dfae');

describe('STUN messages', () => {
    test('a binding request is a bare header with the magic cookie', () => {
        const bytes = encodeRequest(STUN_METHOD.binding, TRANSACTION, []);
        expect(Buffer.from(bytes).toString('hex')).toBe('000100002112a442b7e7a701bc34d686fa87dfae');
    });

    test('attributes are padded to four bytes and read back', () => {
        const bytes = encodeRequest(STUN_METHOD.allocate, TRANSACTION, [requestedTransportUdp(), textAttribute(STUN_ATTRIBUTE.username, 'abcde')]);
        expect(messageLength(bytes)).toBe(bytes.length);
        const message = decodeMessage(bytes)!;
        expect(message.kind).toBe('request');
        expect(message.method).toBe(STUN_METHOD.allocate);
        expect(new TextDecoder().decode(attributeOf(message, STUN_ATTRIBUTE.username)!)).toBe('abcde');
        expect(bytes.length).toBe(HEADER_BYTES + 8 + 12);
    });

    test('MESSAGE-INTEGRITY covers the header with the length that includes it', () => {
        const key = longTermKey('user', 'realm', 'pass');
        const bytes = encodeRequest(STUN_METHOD.allocate, TRANSACTION, [requestedTransportUdp()], key);
        const message = decodeMessage(bytes)!;
        const integrity = attributeOf(message, STUN_ATTRIBUTE.messageIntegrity)!;
        const covered = bytes.slice(0, bytes.length - 24);
        expect(new DataView(covered.buffer).getUint16(2)).toBe(bytes.length - HEADER_BYTES);
        expect(Buffer.from(integrity).toString('hex')).toBe(createHmac('sha1', key).update(covered).digest('hex'));
    });

    test('the long-term key is MD5 over username, realm and password', () => {
        expect(Buffer.from(longTermKey('user', 'realm', 'pass')).toString('hex')).toBe('8493fbc53ba582fb4c044c456bdc40eb');
    });

    test('an error response carries its code', () => {
        const response = hex('0113 0010 2112a442 b7e7a701bc34d686fa87dfae 0009 000c 00000401 556e617574686f72');
        const message = decodeMessage(response)!;
        expect(message.kind).toBe('error');
        expect(errorCodeOf(message)).toBe(401);
    });

    test('anything without the magic cookie is no STUN message', () => {
        expect(decodeMessage(hex('0001 0000 deadbeef b7e7a701bc34d686fa87dfae'))).toBeNull();
        expect(decodeMessage(hex('0001'))).toBeNull();
    });
});
