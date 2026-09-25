import { open } from 'node:fs/promises';
import { join } from 'node:path';
import { Client, StreamableHTTPClientTransport, type CallToolResult, type Tool, type Transport } from '@modelcontextprotocol/client';
import { z } from 'zod';
import { AppleStdioTransport } from './apple-mcp-stdio.ts';

const common = { enabled: z.boolean().optional(), allowedTools: z.array(z.string().min(1).max(200)).max(100).optional() };
export const AppleMcpConfigSchema = z.object({
    mcpServers: z
        .record(
            z.string().regex(/^[a-zA-Z0-9_-]{1,120}$/),
            z.union([
                z
                    .object({
                        ...common,
                        type: z.literal('stdio').optional(),
                        command: z.string().min(1).max(4096),
                        args: z.array(z.string().max(4096)).max(64).default([]),
                        env: z.record(z.string(), z.string().max(8192)).default({})
                    })
                    .strict(),
                z
                    .object({
                        ...common,
                        type: z.literal('http').optional(),
                        url: z.string().url().max(4096),
                        headers: z.record(z.string(), z.string().max(8192)).default({})
                    })
                    .strict()
            ])
        )
        .refine((servers) => Object.keys(servers).length <= 32, 'At most 32 MCP servers may be configured.')
});
export type AppleMcpServer = z.infer<typeof AppleMcpConfigSchema>['mcpServers'][string];

export const readAppleMcpConfig = async (home: string, signal?: AbortSignal): Promise<Record<string, AppleMcpServer>> => {
    signal?.throwIfAborted();
    let handle;
    try {
        handle = await open(join(home, 'apple-mcp.json'), 'r');
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
            return {};
        }
        throw new Error('The Apple MCP configuration could not be opened.');
    }
    try {
        const info = await handle.stat();
        if (!info.isFile() || info.size > 128 * 1024) {
            throw new Error('Apple MCP configuration must be a regular JSON file of at most 128 KiB.');
        }
        const bytes = Buffer.alloc(128 * 1024 + 1);
        const { bytesRead } = await handle.read(bytes, 0, bytes.length, 0);
        signal?.throwIfAborted();
        if (bytesRead > 128 * 1024) {
            throw new Error('Apple MCP configuration exceeds 128 KiB.');
        }
        const parsed = AppleMcpConfigSchema.safeParse(JSON.parse(bytes.subarray(0, bytesRead).toString('utf8')));
        if (!parsed.success) {
            throw new Error('Invalid apple-mcp.json. Use mcpServers with named stdio or HTTP server configurations.');
        }
        return Object.fromEntries(Object.entries(parsed.data.mcpServers).filter(([, server]) => server.enabled !== false));
    } finally {
        await handle.close();
    }
};

export const expandMcpEnvironment = (values: Record<string, string>, env: Record<string, string>): Record<string, string> =>
    Object.fromEntries(
        Object.entries(values).map(([key, value]) => [
            key,
            value.replace(/\$\{([A-Z_a-z][A-Z_a-z0-9]*)\}/g, (_match, name: string) => {
                if (env[name] === undefined) {
                    throw new Error(`MCP configuration needs the account variable ${name}.`);
                }
                return env[name];
            })
        ])
    );

export interface AppleMcpConnection {
    list(signal: AbortSignal): Promise<Tool[]>;
    call(name: string, args: Record<string, unknown>, signal: AbortSignal): Promise<CallToolResult>;
    close(): Promise<void>;
}
export type ConnectAppleMcp = (server: AppleMcpServer, cwd: string, env: Record<string, string>, signal: AbortSignal) => Promise<AppleMcpConnection>;

export const connectAppleMcp: ConnectAppleMcp = async (server, cwd, env, signal) => {
    const client = new Client(
        { name: 'ruimte-apple-foundation', version: '1.0.0' },
        { versionNegotiation: { mode: 'command' in server ? 'legacy' : 'auto' }, listMaxPages: 5 }
    );
    let transport: Transport;
    let http: StreamableHTTPClientTransport | undefined;
    if ('command' in server) {
        const inherited = Object.fromEntries(
            ['PATH', 'HOME', 'TMPDIR', 'LANG', 'LC_ALL', 'SHELL'].flatMap((key) => (env[key] === undefined ? [] : [[key, env[key]!]]))
        );
        transport = new AppleStdioTransport({
            command: server.command,
            args: server.args,
            cwd,
            env: { ...inherited, ...expandMcpEnvironment(server.env, env) }
        });
    } else {
        const url = new URL(server.url);
        if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) {
            throw new Error('MCP URLs must use HTTP or HTTPS without embedded credentials.');
        }
        http = new StreamableHTTPClientTransport(url, {
            requestInit: { headers: expandMcpEnvironment(server.headers, env) },
            fetch: async (input, init) => {
                const target = new URL(input instanceof Request ? input.url : String(input));
                if (target.origin !== url.origin) {
                    throw new Error('The MCP server attempted to contact an unconfigured origin.');
                }
                const response = await fetch(input, { ...init, redirect: 'error' });
                if (!response.body) {
                    return response;
                }
                let bytes = 0;
                const body = response.body.pipeThrough(
                    new TransformStream<Uint8Array, Uint8Array>({
                        transform(chunk, controller) {
                            bytes += chunk.byteLength;
                            if (bytes > 1024 * 1024) {
                                controller.error(new Error('MCP response exceeded 1 MiB.'));
                            } else {
                                controller.enqueue(chunk);
                            }
                        }
                    })
                );
                return new Response(body, { status: response.status, statusText: response.statusText, headers: response.headers });
            }
        });
        transport = http;
    }
    const abortStartup = (): void => {
        void transport.close().catch(() => undefined);
        void client.close().catch(() => undefined);
    };
    signal.addEventListener('abort', abortStartup, { once: true });
    try {
        signal.throwIfAborted();
        await client.connect(transport, { signal, timeout: 15_000 });
        signal.throwIfAborted();
    } catch (error) {
        await client.close().catch(() => undefined);
        throw error;
    } finally {
        signal.removeEventListener('abort', abortStartup);
    }
    let closing: Promise<void> | undefined;
    return {
        list: async (currentSignal) => (await client.listTools(undefined, { signal: currentSignal, timeout: 20_000 })).tools,
        call: (name, args, currentSignal) => client.callTool({ name, arguments: args }, { signal: currentSignal, timeout: 30_000 }),
        close: () =>
            (closing ??= (async () => {
                // Terminating a remote session must not hold up stopping the local chat.
                if (http) {
                    void http.terminateSession().catch(() => undefined);
                }
                await client.close();
            })())
    };
};

export class AppleMcpPool {
    private readonly connections = new Map<string, { fingerprint: string; ready: Promise<AppleMcpConnection> }>();
    private closed = false;
    private readonly connect: ConnectAppleMcp;

    constructor(connect: ConnectAppleMcp = connectAppleMcp) {
        this.connect = connect;
    }

    async get(name: string, config: AppleMcpServer, cwd: string, env: Record<string, string>, signal: AbortSignal): Promise<AppleMcpConnection> {
        signal.throwIfAborted();
        if (this.closed) {
            throw new Error('This chat has closed its MCP connections.');
        }
        const fingerprint = JSON.stringify(config);
        let entry = this.connections.get(name);
        if (entry && entry.fingerprint !== fingerprint) {
            this.connections.delete(name);
            await (await entry.ready).close();
            entry = undefined;
        }
        if (!entry) {
            const ready = this.connect(config, cwd, env, signal);
            entry = { fingerprint, ready };
            this.connections.set(name, entry);
            const current = entry;
            void ready.catch(() => {
                if (this.connections.get(name) === current) {
                    this.connections.delete(name);
                }
            });
        }
        const connection = await entry.ready;
        if (this.closed || signal.aborted) {
            await this.invalidate(name, connection);
            signal.throwIfAborted();
            throw new Error('This chat has closed its MCP connections.');
        }
        return connection;
    }

    async invalidate(name: string, connection: AppleMcpConnection): Promise<void> {
        const entry = this.connections.get(name);
        if (entry && (await entry.ready.catch(() => null)) === connection && this.connections.get(name) === entry) {
            this.connections.delete(name);
        }
        await connection.close().catch(() => undefined);
    }

    async close(): Promise<void> {
        this.closed = true;
        const entries = [...this.connections.values()];
        this.connections.clear();
        await Promise.allSettled(entries.map(async (entry) => (await entry.ready).close()));
    }
}
