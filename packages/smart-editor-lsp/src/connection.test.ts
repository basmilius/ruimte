import { describe, expect, it, jest } from 'bun:test';
import { JsonRpcConnection, LspError } from './connection.ts';
import { flush, rejecting, ScriptedTransport } from './test-transport.ts';

describe('JSON-RPC lifecycle', () => {
    it('correlates out-of-order replies and preserves remote error data', async () => {
        const transport = new ScriptedTransport();
        const rpc = new JsonRpcConnection(transport);
        const first = rpc.request('first');
        const second = rpc.request('second');
        const failure = rejecting(first, (error) => expect(error).toMatchObject({ code: -32001, data: { retry: false } }));
        await flush();
        transport.respond('second', { value: 2 });
        transport.emit({ jsonrpc: '2.0', id: transport.request('first').id, error: { code: -32001, message: 'Rejected', data: { retry: false } } });
        expect(await second).toEqual({ value: 2 });
        await failure;
        await rpc.close();
    });

    it('cancels once, ignores a late reply and does not send already aborted requests', async () => {
        const transport = new ScriptedTransport();
        const rpc = new JsonRpcConnection(transport);
        const controller = new AbortController();
        const request = rpc.request('slow', {}, { signal: controller.signal });
        const rejected = rejecting(request, (error) => expect(error).toMatchObject({ code: -32800 }));
        await flush();
        controller.abort();
        await rejected;
        await flush();
        expect(transport.sent).toContainEqual({ jsonrpc: '2.0', method: '$/cancelRequest', params: { id: transport.request('slow').id } });
        transport.respond('slow', 'late');
        await expect(rpc.request('never', {}, { signal: controller.signal })).rejects.toBeInstanceOf(LspError);
        expect(transport.methods()).not.toContain('never');
        await rpc.close();
    });

    it('times out with a wire cancellation and rejects pending requests on close', async () => {
        jest.useFakeTimers();
        try {
            const transport = new ScriptedTransport();
            const rpc = new JsonRpcConnection(transport, 10);
            const rejected = rejecting(rpc.request('timeout'), (error) => expect((error as Error).message).toContain('timed out'));
            await flush();
            jest.advanceTimersByTime(10);
            await rejected;
            expect(transport.methods()).toContain('$/cancelRequest');
            const closed = rejecting(rpc.request('pending'), (error) => expect((error as Error).message).toContain('closed'));
            await rpc.close();
            await closed;
        } finally {
            jest.useRealTimers();
        }
    });

    it('sets no timer when the deadline is off', async () => {
        const transport = new ScriptedTransport();
        const rpc = new JsonRpcConnection(transport, 0);
        const spy = jest.spyOn(globalThis, 'setTimeout');
        try {
            const request = rpc.request('forever');
            await flush();
            expect(spy).not.toHaveBeenCalled();
            transport.respond('forever', 1);
            expect(await request).toBe(1);
        } finally {
            spy.mockRestore();
        }
        await rpc.close();
    });

    it('handles incoming requests, unknown methods and server cancellation', async () => {
        const transport = new ScriptedTransport();
        const rpc = new JsonRpcConnection(transport);
        let finish: (value: unknown) => void = () => undefined;
        let signal: AbortSignal | undefined;
        rpc.onRequest('slow-server-request', (_params, incomingSignal) => {
            signal = incomingSignal;
            return new Promise((resolve) => {
                finish = resolve;
            });
        });
        transport.emit({ jsonrpc: '2.0', id: 'missing', method: 'unknown' });
        transport.emit({ jsonrpc: '2.0', id: 'slow', method: 'slow-server-request' });
        transport.emit({ jsonrpc: '2.0', method: '$/cancelRequest', params: { id: 'slow' } });
        expect(signal?.aborted).toBe(true);
        finish('ignored');
        await flush();
        expect(transport.sent).toContainEqual(expect.objectContaining({ id: 'missing', error: expect.objectContaining({ code: -32601 }) }));
        expect(transport.sent).toContainEqual(expect.objectContaining({ id: 'slow', error: expect.objectContaining({ code: -32800 }) }));
        await rpc.close();
    });

    it('rejects all pending work when a transport send fails', async () => {
        const transport = new ScriptedTransport();
        transport.send = () => {
            throw new Error('Socket failed');
        };
        const rpc = new JsonRpcConnection(transport);
        const closed = jest.fn();
        rpc.onClose(closed);
        await expect(rpc.request('first')).rejects.toThrow('Socket failed');
        expect(closed).toHaveBeenCalledTimes(1);
        await expect(rpc.request('second')).rejects.toThrow('closed');
    });

    it('reports a malformed message to the error listeners and keeps going', async () => {
        const transport = new ScriptedTransport();
        const rpc = new JsonRpcConnection(transport);
        const errors: Error[] = [];
        rpc.onError((error) => errors.push(error));
        transport.emit({ not: 'jsonrpc' } as never);
        await flush();
        expect(errors[0]?.message).toBe('Invalid JSON-RPC message');
        const request = rpc.request('after');
        await flush();
        transport.respond('after', true);
        expect(await request).toBe(true);
        await rpc.close();
    });
});
