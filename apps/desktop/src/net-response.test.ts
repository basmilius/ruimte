import { describe, expect, test } from 'bun:test';
import { EventEmitter } from 'node:events';
import { heedBodyless } from './net-response';

/* A response as `net.fetch` builds it, with the message it read the headers from. */
function fetched(status: number, body: string | null): { response: Response; message: EventEmitter } {
    const message = new EventEmitter();
    const response = new Response(body, { status });
    Object.assign(response, { __original_resp: message });

    return { response, message };
}

describe('a response from the shell', () => {
    test('without a body takes a connection that fails after its headers without throwing', () => {
        const { response, message } = fetched(304, null);

        expect(() => message.emit('error', new Error('net::ERR_HTTP2_PROTOCOL_ERROR'))).toThrow('net::ERR_HTTP2_PROTOCOL_ERROR');
        expect(heedBodyless(response)).toBe(response);
        expect(() => message.emit('error', new Error('net::ERR_HTTP2_PROTOCOL_ERROR'))).not.toThrow();
    });

    test('with a body is left to its stream, which reports the error to whoever reads it', () => {
        const { response, message } = fetched(200, '{}');

        heedBodyless(response);

        expect(message.listenerCount('error')).toBe(0);
    });
});
