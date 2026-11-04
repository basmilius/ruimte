import { describe, expect, test } from 'bun:test';
import { connectApiMcp, type ApiMcpConnection } from './api-mcp.ts';

const NEVER_ABORTED = new AbortController().signal;

describe.skipIf(process.platform === 'win32')('Api MCP configured HTTP connection', () => {
    test('negotiates, calls the configured local server with headers, and cancels a pending request', async () => {
        const requests: Array<{ method: string; authorization: string | null }> = [];
        let finishHang: (() => void) | undefined;
        const { promise: hanging, resolve: startedHang } = Promise.withResolvers<void>();
        const http = Bun.serve({
            hostname: '127.0.0.1',
            port: 0,
            fetch: async (request) => {
                if (request.method === 'GET') {
                    return new Response(null, { status: 405 });
                }
                if (request.method === 'DELETE') {
                    return new Response(null, { status: 204 });
                }
                const message = (await request.json()) as {
                    id?: string | number;
                    method: string;
                    params?: { protocolVersion?: string; name?: string; arguments?: Record<string, unknown> };
                };
                requests.push({ method: message.method, authorization: request.headers.get('authorization') });
                const result = (value: unknown, headers?: Record<string, string>) =>
                    Response.json({ jsonrpc: '2.0', id: message.id, result: value }, { headers });
                if (message.method === 'server/discover') {
                    return Response.json({ jsonrpc: '2.0', id: message.id, error: { code: -32601, message: 'Use initialize' } });
                }
                if (message.method === 'initialize') {
                    return result(
                        { protocolVersion: message.params?.protocolVersion, serverInfo: { name: 'http-fixture', version: '1' }, capabilities: { tools: {} } },
                        { 'mcp-session-id': 'fixture-session' }
                    );
                }
                if (message.method === 'tools/list') {
                    return result({
                        tools: [
                            { name: 'echo', inputSchema: { type: 'object' } },
                            { name: 'hang', inputSchema: { type: 'object' } }
                        ]
                    });
                }
                if (message.method === 'tools/call' && message.params?.name === 'hang') {
                    startedHang();
                    return new Promise<Response>((resolve) => {
                        finishHang = () => resolve(result({ content: [{ type: 'text', text: 'late' }] }));
                    });
                }
                if (message.method === 'tools/call') {
                    return result({ content: [{ type: 'text', text: String(message.params?.arguments?.message) }] });
                }
                return new Response(null, { status: 202 });
            }
        });
        let connection: ApiMcpConnection | undefined;
        try {
            connection = await connectApiMcp(
                { url: `http://127.0.0.1:${http.port}/mcp`, headers: { Authorization: 'Bearer ${ACCOUNT_TOKEN}' } },
                { ACCOUNT_TOKEN: 'configured-secret' },
                NEVER_ABORTED
            );
            expect((await connection.list(NEVER_ABORTED)).map((tool) => tool.name)).toEqual(['echo', 'hang']);
            const result = await connection.call('echo', { message: 'HTTP tool result' }, NEVER_ABORTED);
            expect(result.content).toEqual([{ type: 'text', text: 'HTTP tool result' }]);
            expect(requests.every((request) => request.authorization === 'Bearer configured-secret')).toBe(true);
            const controller = new AbortController();
            const pending = connection.call('hang', {}, controller.signal);
            await hanging;
            controller.abort();
            await expect(pending).rejects.toThrow();
        } finally {
            finishHang?.();
            await connection?.close();
            await http.stop(true);
        }
    });

    test('aborts an HTTP discovery request before the handshake timeout', async () => {
        const { promise: received, resolve: started } = Promise.withResolvers<void>();
        let finish!: () => void;
        const http = Bun.serve({
            hostname: '127.0.0.1',
            port: 0,
            fetch: async (request) => {
                await request.text();
                started();
                return new Promise<Response>((resolve) => {
                    finish = () => resolve(new Response(null, { status: 500 }));
                });
            }
        });
        const controller = new AbortController();
        const pending = connectApiMcp({ url: `http://127.0.0.1:${http.port}/mcp`, headers: {} }, {}, controller.signal);
        let timer: ReturnType<typeof setTimeout> | undefined;
        try {
            await received;
            controller.abort();
            const outcome = await Promise.race([
                pending.then(
                    () => 'connected',
                    () => 'aborted'
                ),
                new Promise<string>((resolve) => {
                    timer = setTimeout(() => resolve('still-pending'), 1000);
                })
            ]);
            expect(outcome).toBe('aborted');
        } finally {
            clearTimeout(timer);
            finish?.();
            controller.abort();
            await http.stop(true);
            await pending.then(
                (connection) => connection.close(),
                () => undefined
            );
        }
    });

    test('never follows a configured HTTP server redirect to another origin', async () => {
        let received = false;
        const target = Bun.serve({
            hostname: '127.0.0.1',
            port: 0,
            fetch: () => {
                received = true;
                return new Response('unexpected');
            }
        });
        const redirect = Bun.serve({
            hostname: '127.0.0.1',
            port: 0,
            fetch: () => new Response(null, { status: 302, headers: { Location: `http://127.0.0.1:${target.port}/other` } })
        });
        try {
            await expect(
                connectApiMcp({ url: `http://127.0.0.1:${redirect.port}/mcp`, headers: { Authorization: 'Bearer must-not-forward' } }, {}, NEVER_ABORTED)
            ).rejects.toThrow();
            expect(received).toBe(false);
        } finally {
            await Promise.all([target.stop(true), redirect.stop(true)]);
        }
    });
});
