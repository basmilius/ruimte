import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { Server, WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/server';
import { connectApiMcp, EXTERNAL_MCP_LIMITS, RUIMTE_MCP_LIMITS, type ApiMcpServer } from './api-mcp.ts';

const SERVER: ApiMcpServer = { type: 'http', url: 'http://127.0.0.1:4210/mcp', headers: {} };
const PICTURE = Buffer.alloc(800 * 1024, 7).toString('base64');

const original = globalThis.fetch;
let hung: (request: Request) => void;

/* An MCP server in this process, answered through `fetch`, with a tool that hands back a picture and one that never answers. */
async function answer(request: Request): Promise<Response> {
    const server = new Server({ name: 'test', version: '1' }, { capabilities: { tools: {} } });

    server.setRequestHandler('tools/list', async () => ({
        tools: [
            { name: 'shot', inputSchema: { type: 'object' as const } },
            { name: 'hang', inputSchema: { type: 'object' as const } }
        ]
    }));
    server.setRequestHandler('tools/call', async (call) => {
        if (call.params.name === 'hang') {
            hung(request);

            return new Promise(() => {});
        }

        return { content: [{ type: 'image' as const, data: PICTURE, mimeType: 'image/png' }] };
    });

    const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
    await server.connect(transport);

    return transport.handleRequest(request);
}

beforeEach(() => {
    hung = () => {};
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => answer(new Request(input, init))) as typeof fetch;
});

afterEach(() => {
    globalThis.fetch = original;
});

describe('connectApiMcp', () => {
    test("Ruimte's own server answers a picture larger than a configured server may", async () => {
        const signal = new AbortController().signal;
        const own = await connectApiMcp(SERVER, '/work', {}, signal, RUIMTE_MCP_LIMITS);
        const external = await connectApiMcp(SERVER, '/work', {}, signal, EXTERNAL_MCP_LIMITS);

        try {
            expect((await own.call('shot', {}, signal)).content).toEqual([{ type: 'image', data: PICTURE, mimeType: 'image/png' }]);
            await expect(external.call('shot', {}, signal)).rejects.toThrow();
        } finally {
            await own.close();
            await external.close();
        }
    });

    test('a cancelled call ends its request', async () => {
        const connection = await connectApiMcp(SERVER, '/work', {}, new AbortController().signal, RUIMTE_MCP_LIMITS);
        const turn = new AbortController();
        const reached = new Promise<Request>((resolve) => {
            hung = resolve;
        });

        try {
            const call = connection.call('hang', {}, turn.signal);
            const request = await reached;
            turn.abort();

            await expect(call).rejects.toThrow();
            expect(request.signal.aborted).toBe(true);
        } finally {
            await connection.close();
        }
    });
});
