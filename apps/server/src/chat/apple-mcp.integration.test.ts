import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { connectAppleMcp, type AppleMcpConnection, type AppleMcpServer } from './apple-mcp.ts';
import { AppleStdioTransport } from './apple-mcp-stdio.ts';

let cwd: string;
const fixture = String.raw`
import { createInterface } from 'node:readline';
import { writeFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
writeFileSync('server.pid', String(process.pid));
const answer = (id, result) => process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id, result }) + '\n');
const lines = createInterface({ input: process.stdin });
lines.on('line', (line) => {
    const message = JSON.parse(line);
    if (message.method === 'initialize') {
        if (process.env.HANG_INITIALIZE === '1') {
            writeFileSync('initialize.pending', 'yes');
            return;
        }
        const child = spawn('/bin/sleep', ['60'], { stdio: 'ignore' });
        writeFileSync('descendant.pid', String(child.pid));
        answer(message.id, { protocolVersion: message.params.protocolVersion, serverInfo: { name: 'fixture', version: '1' }, capabilities: { tools: {} } });
    } else if (message.method === 'tools/list') {
        answer(message.id, { tools: [{ name: 'echo', inputSchema: { type: 'object' } }, { name: 'fail', inputSchema: { type: 'object' } }, { name: 'hang', inputSchema: { type: 'object' } }] });
    } else if (message.method === 'tools/call') {
        if (message.params.name === 'hang') {
            writeFileSync('call.pending', 'yes');
            return;
        }
        answer(message.id, { content: [{ type: 'text', text: JSON.stringify({ message: message.params.arguments.message, explicit: process.env.EXPLICIT_TOKEN, unlisted: process.env.UNRELATED_SECRET }) }], isError: message.params.name === 'fail' });
    } else if (message.method === 'notifications/cancelled') {
        writeFileSync('call.cancelled', 'yes');
    } else if (message.id !== undefined) {
        process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: message.id, error: { code: -32601, message: 'Method not found' } }) + '\n');
    }
});
lines.on('close', () => process.exit(0));
`;

beforeEach(async () => {
    cwd = await mkdtemp(join(tmpdir(), 'ruimte-apple-mcp-'));
    await writeFile(join(cwd, 'fixture.mjs'), fixture);
});

afterEach(async () => {
    for (const name of ['server.pid', 'descendant.pid']) {
        const pid = Number(await readFile(join(cwd, name), 'utf8').catch(() => '0'));
        if (pid > 0 && alive(pid)) {
            process.kill(pid, 'SIGKILL');
        }
    }
    await rm(cwd, { recursive: true, force: true });
});

const alive = (pid: number): boolean => {
    try {
        process.kill(pid, 0);
        return true;
    } catch {
        return false;
    }
};
const eventually = async (condition: () => Promise<boolean> | boolean): Promise<void> => {
    for (let attempt = 0; attempt < 200; attempt++) {
        if (await condition()) {
            return;
        }
        await new Promise((resolve) => setTimeout(resolve, 10));
    }
    throw new Error('The MCP fixture did not reach the expected state.');
};
const server = (env: Record<string, string> = {}): AppleMcpServer => ({ command: process.execPath, args: [join(cwd, 'fixture.mjs')], env });
const exists = (name: string): Promise<boolean> => Bun.file(join(cwd, name)).exists();

describe('Apple MCP real stdio connection', () => {
    test('initializes, lists, calls, isolates account variables, and closes descendants', async () => {
        const connection = await connectAppleMcp(
            server({ EXPLICIT_TOKEN: '${ACCOUNT_TOKEN}' }),
            cwd,
            { PATH: '/usr/bin:/bin', ACCOUNT_TOKEN: 'fixture-token', UNRELATED_SECRET: 'must-not-inherit' },
            new AbortController().signal
        );
        try {
            expect((await connection.list(new AbortController().signal)).map((tool) => tool.name)).toEqual(['echo', 'fail', 'hang']);
            const result = await connection.call('echo', { message: 'hello' }, new AbortController().signal);
            expect(result.isError).toBe(false);
            const text = result.content.find((block) => block.type === 'text');
            expect(text?.type === 'text' && JSON.parse(text.text)).toEqual({ message: 'hello', explicit: 'fixture-token' });
            expect((await connection.call('fail', {}, new AbortController().signal)).isError).toBe(true);
        } finally {
            await connection.close();
        }
        const serverPid = Number(await readFile(join(cwd, 'server.pid'), 'utf8'));
        const childPid = Number(await readFile(join(cwd, 'descendant.pid'), 'utf8'));
        await eventually(() => !alive(serverPid) && !alive(childPid));
        expect(alive(childPid)).toBe(false);
    });

    test('aborts a pending tool request and leaves the connection closable', async () => {
        const connection = await connectAppleMcp(server(), cwd, {}, new AbortController().signal);
        const controller = new AbortController();
        try {
            const pending = connection.call('hang', {}, controller.signal);
            await eventually(() => exists('call.pending'));
            controller.abort();
            await expect(pending).rejects.toThrow();
            await eventually(() => exists('call.cancelled'));
        } finally {
            controller.abort();
            await connection.close();
        }
    });

    test('aborts startup without waiting for the handshake timeout', async () => {
        const controller = new AbortController();
        const pending = connectAppleMcp(server({ HANG_INITIALIZE: '1' }), cwd, {}, controller.signal);
        try {
            await eventually(() => exists('initialize.pending'));
            controller.abort();
            await expect(pending).rejects.toThrow();
            const pid = Number(await readFile(join(cwd, 'server.pid'), 'utf8'));
            await eventually(() => !alive(pid));
        } finally {
            controller.abort();
            await pending.then(
                (connection) => connection.close(),
                () => undefined
            );
        }
    });

    test('closes a process that sends an oversized or malformed frame', async () => {
        const transport = new AppleStdioTransport({
            command: process.execPath,
            args: ['-e', 'process.stdout.write("x".repeat(1024*1024+1)); setInterval(()=>{},1000)'],
            env: {},
            cwd
        });
        let error: Error | undefined;
        let settle!: () => void;
        const closed = new Promise<void>((resolve) => {
            settle = resolve;
        });
        transport.onerror = (value) => {
            error = value;
        };
        transport.onclose = settle;
        try {
            await transport.start();
            await closed;
            expect(error).toBeInstanceOf(Error);
        } finally {
            await transport.close();
        }
    });
});

describe('Apple MCP configured HTTP connection', () => {
    test('negotiates, calls the configured local server with headers, and cancels a pending request', async () => {
        const requests: Array<{ method: string; authorization: string | null }> = [];
        let finishHang: (() => void) | undefined;
        let startedHang!: () => void;
        const hanging = new Promise<void>((resolve) => {
            startedHang = resolve;
        });
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
        let connection: AppleMcpConnection | undefined;
        try {
            connection = await connectAppleMcp(
                { url: `http://127.0.0.1:${http.port}/mcp`, headers: { Authorization: 'Bearer ${ACCOUNT_TOKEN}' } },
                cwd,
                { ACCOUNT_TOKEN: 'configured-secret' },
                new AbortController().signal
            );
            expect((await connection.list(new AbortController().signal)).map((tool) => tool.name)).toEqual(['echo', 'hang']);
            const result = await connection.call('echo', { message: 'HTTP tool result' }, new AbortController().signal);
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
        let started!: () => void;
        const received = new Promise<void>((resolve) => {
            started = resolve;
        });
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
        const pending = connectAppleMcp({ url: `http://127.0.0.1:${http.port}/mcp`, headers: {} }, cwd, {}, controller.signal);
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
                connectAppleMcp(
                    { url: `http://127.0.0.1:${redirect.port}/mcp`, headers: { Authorization: 'Bearer must-not-forward' } },
                    cwd,
                    {},
                    new AbortController().signal
                )
            ).rejects.toThrow();
            expect(received).toBe(false);
        } finally {
            await Promise.all([target.stop(true), redirect.stop(true)]);
        }
    });
});
