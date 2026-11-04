import { AsyncLocalStorage } from 'node:async_hooks';
import { closeSync, fstatSync, openSync, readSync } from 'node:fs';
import { open } from 'node:fs/promises';
import { join } from 'node:path';
import { isNotFound } from '@adecore/agents';
import type { ChatMcpServer } from '@adecore/agents/chat';
import { Client, StreamableHTTPClientTransport, type CallToolResult, type Tool, type Transport } from '@modelcontextprotocol/client';
import { z } from 'zod';
import { CHAT_TOKEN_VARIABLE, MCP_MAX_IMAGE_BYTES, MCP_REQUEST_TIMEOUT_S, MCP_SERVER, MCP_URL_VARIABLE } from '../providers/ruimte-mcp.ts';
import { ApiStdioTransport } from './api-mcp-stdio.ts';

const common = { enabled: z.boolean().optional(), allowedTools: z.array(z.string().min(1).max(200)).max(100).optional() };
const ApiMcpConfigSchema = z.object({
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
export type ApiMcpServer = z.infer<typeof ApiMcpConfigSchema>['mcpServers'][string];

const CONFIG_FILE = 'api-mcp.json';
const MAX_CONFIG_BYTES = 128 * 1024;

function openFailure(error: unknown): Error | null {
    return isNotFound(error) ? null : new Error('The Api MCP configuration could not be opened.');
}

function checkConfigFile(info: { isFile(): boolean; size: number }): void {
    if (!info.isFile() || info.size > MAX_CONFIG_BYTES) {
        throw new Error('Api MCP configuration must be a regular JSON file of at most 128 KiB.');
    }
}

function parseApiMcpConfig(bytes: Buffer, bytesRead: number): Record<string, ApiMcpServer> {
    if (bytesRead > MAX_CONFIG_BYTES) {
        throw new Error('Api MCP configuration exceeds 128 KiB.');
    }

    const parsed = ApiMcpConfigSchema.safeParse(JSON.parse(bytes.subarray(0, bytesRead).toString('utf8')));

    if (!parsed.success) {
        throw new Error('Invalid api-mcp.json. Use mcpServers with named stdio or HTTP server configurations.');
    }

    return Object.fromEntries(Object.entries(parsed.data.mcpServers).filter(([, server]) => server.enabled !== false));
}

export async function readApiMcpConfig(home: string, signal?: AbortSignal): Promise<Record<string, ApiMcpServer>> {
    signal?.throwIfAborted();
    let handle;
    try {
        handle = await open(join(home, CONFIG_FILE), 'r');
    } catch (error) {
        const failure = openFailure(error);
        if (failure === null) {
            return {};
        }
        throw failure;
    }
    try {
        checkConfigFile(await handle.stat());
        const bytes = Buffer.alloc(MAX_CONFIG_BYTES + 1);
        const { bytesRead } = await handle.read(bytes, 0, bytes.length, 0);
        signal?.throwIfAborted();
        return parseApiMcpConfig(bytes, bytesRead);
    } finally {
        await handle.close();
    }
}

/* The same file, read where a backend is made, which cannot wait; it is small enough to read at once. */
export function readApiMcpConfigSync(home: string): Record<string, ApiMcpServer> {
    let fd;
    try {
        fd = openSync(join(home, CONFIG_FILE), 'r');
    } catch (error) {
        const failure = openFailure(error);
        if (failure === null) {
            return {};
        }
        throw failure;
    }
    try {
        checkConfigFile(fstatSync(fd));
        const bytes = Buffer.alloc(MAX_CONFIG_BYTES + 1);
        return parseApiMcpConfig(bytes, readSync(fd, bytes, 0, bytes.length, 0));
    } finally {
        closeSync(fd);
    }
}

/*
 * The servers of `api-mcp.json` a CLI loads itself. It takes only HTTP servers, and expands a `${VAR}` in their headers
 * from its own environment. A stdio server is left out, and so is one with `allowedTools`, whose limit the CLI would not
 * keep. Ruimte's own server wins over one of the same name.
 */
export function cliMcpServers(servers: Record<string, ApiMcpServer>): ChatMcpServer[] {
    return Object.entries(servers).flatMap(([name, server]) =>
        name === MCP_SERVER || !('url' in server) || server.allowedTools !== undefined ? [] : [{ name, url: server.url, headers: server.headers }]
    );
}

export function expandMcpEnvironment(values: Record<string, string>, env: Record<string, string>): Record<string, string> {
    return Object.fromEntries(
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
}

/* Ruimte's own server, for a chat the daemon gave a token; it wins over a server of the same name in `api-mcp.json`. */
export function ruimteMcpServer(env: Record<string, string>): Record<string, ApiMcpServer> {
    const url = env[MCP_URL_VARIABLE];
    if (url === undefined || env[CHAT_TOKEN_VARIABLE] === undefined) {
        return {};
    }
    return { [MCP_SERVER]: { type: 'http', url, headers: { Authorization: `Bearer \${${CHAT_TOKEN_VARIABLE}}` } } };
}

/* A tool's result as the text a model that reads only text gets. */
export function mcpResultText(result: CallToolResult): string {
    const content = result.content
        .map((block) => {
            if (block.type === 'text') {
                return block.text;
            }
            if (block.type === 'resource' && 'text' in block.resource) {
                return block.resource.text;
            }
            if (block.type === 'resource_link') {
                return `Resource: ${block.name} ${block.uri}`;
            }
            return `[${block.type} content omitted: this model accepts text]`;
        })
        .join('\n\n');
    const structured = result.structuredContent === undefined ? '' : `\n${JSON.stringify(result.structuredContent)}`;

    return content + structured;
}

export interface ApiMcpConnection {
    list(signal: AbortSignal): Promise<Tool[]>;
    call(name: string, args: Record<string, unknown>, signal: AbortSignal): Promise<CallToolResult>;
    close(): Promise<void>;
}

/* How long a tool call may take and how large an HTTP answer may be. */
export interface ApiMcpLimits {
    callTimeoutMs: number;
    responseBytes: number;
}

/* A server a person configured. */
export const EXTERNAL_MCP_LIMITS: ApiMcpLimits = { callTimeoutMs: 30_000, responseBytes: 1024 * 1024 };

/*
 * Ruimte's own server: the time its route gives a call, and its largest picture in base64 with room for
 * the text and the JSON around it.
 */
export const RUIMTE_MCP_LIMITS: ApiMcpLimits = {
    callTimeoutMs: MCP_REQUEST_TIMEOUT_S * 1000,
    responseBytes: Math.ceil(MCP_MAX_IMAGE_BYTES / 3) * 4 + 1024 * 1024
};

export type ConnectApiMcp = (
    server: ApiMcpServer,
    cwd: string,
    env: Record<string, string>,
    signal: AbortSignal,
    limits?: ApiMcpLimits
) => Promise<ApiMcpConnection>;

/* The signal of the tool call a request of the transport is for, so a call that is cancelled ends its request too. */
const callSignal = new AsyncLocalStorage<AbortSignal>();

export async function connectApiMcp(
    server: ApiMcpServer,
    cwd: string,
    env: Record<string, string>,
    signal: AbortSignal,
    limits: ApiMcpLimits = EXTERNAL_MCP_LIMITS
): Promise<ApiMcpConnection> {
    const client = new Client(
        { name: 'ruimte-api-foundation', version: '1.0.0' },
        { versionNegotiation: { mode: 'command' in server ? 'legacy' : 'auto' }, listMaxPages: 5 }
    );
    let transport: Transport;
    let http: StreamableHTTPClientTransport | undefined;
    if ('command' in server) {
        const inherited = Object.fromEntries(
            ['PATH', 'HOME', 'TMPDIR', 'LANG', 'LC_ALL', 'SHELL'].flatMap((key) => (env[key] === undefined ? [] : [[key, env[key]!]]))
        );
        transport = new ApiStdioTransport({
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
                const cancelled = callSignal.getStore();
                const signals = [init?.signal, cancelled].filter((candidate): candidate is AbortSignal => candidate !== undefined && candidate !== null);
                const response = await fetch(input, { ...init, redirect: 'error', ...(signals.length === 0 ? {} : { signal: AbortSignal.any(signals) }) });
                if (!response.body) {
                    return response;
                }
                let bytes = 0;
                const body = response.body.pipeThrough(
                    new TransformStream<Uint8Array, Uint8Array>({
                        transform(chunk, controller) {
                            bytes += chunk.byteLength;
                            if (bytes > limits.responseBytes) {
                                controller.error(new Error(`MCP response exceeded ${Math.floor(limits.responseBytes / 1024 / 1024)} MiB.`));
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
        call: (name, args, currentSignal) =>
            callSignal.run(currentSignal, () => client.callTool({ name, arguments: args }, { signal: currentSignal, timeout: limits.callTimeoutMs })),
        close: () =>
            (closing ??= (async () => {
                // Terminating a remote session must not hold up stopping the local chat.
                if (http) {
                    void http.terminateSession().catch(() => undefined);
                }
                await client.close();
            })())
    };
}

export class ApiMcpPool {
    private readonly connections = new Map<string, { fingerprint: string; ready: Promise<ApiMcpConnection> }>();
    private closed = false;
    private readonly connect: ConnectApiMcp;

    constructor(connect: ConnectApiMcp = connectApiMcp) {
        this.connect = connect;
    }

    async get(name: string, config: ApiMcpServer, cwd: string, env: Record<string, string>, signal: AbortSignal): Promise<ApiMcpConnection> {
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

    async invalidate(name: string, connection: ApiMcpConnection): Promise<void> {
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
