import { EventEmitter } from 'node:events';

/*
 * Electron's `net.fetch` hands a response without a body (101, 204, 205, 304, or one to HEAD) no stream,
 * so nothing listens on the message under it, kept as `__original_resp`. When the connection fails after
 * the headers (`net::ERR_HTTP2_PROTOCOL_ERROR`), the request destroys that message with the error, and an
 * `error` event without a listener throws in the main process. A response with a body is covered by the
 * stream `Readable.toWeb` makes of it. The caller already holds its whole answer, so the error is dropped.
 */
export function heedBodyless(response: Response): Response {
    const message: unknown = (response as { __original_resp?: unknown }).__original_resp;

    if (response.body === null && message instanceof EventEmitter && message.listenerCount('error') === 0) {
        message.on('error', () => undefined);
    }

    return response;
}
