import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { CallToolResult, Tool } from '@modelcontextprotocol/client';
import { AppleMcpPool, expandMcpEnvironment, readAppleMcpConfig, type AppleMcpConnection, type AppleMcpServer, type ConnectAppleMcp } from './apple-mcp.ts';
import { appleTextResult, closeAppleNetworkTools, executeAppleNetworkTool } from './apple-network-tools.ts';
import type { AppleToolCall, AppleToolContext } from './apple-tools.ts';
import type { AppleWebRequest } from './apple-web.ts';

const contexts: AppleToolContext[] = [];
const folders: string[] = [];
afterEach(async () => {
    await Promise.all(contexts.splice(0).map(closeAppleNetworkTools));
    await Promise.all(folders.splice(0).map((folder) => rm(folder, { recursive: true, force: true })));
});
const context = (env: Record<string, string> = {}): AppleToolContext => {
    const value = { env, home: '/unused-apple-home' };
    contexts.push(value);
    return value;
};
const configured: AppleMcpServer = { command: 'configured-server', args: [], env: {}, allowedTools: ['echo', 'fail'] };
const tool = (name: string): Tool => ({ name, description: `${name} tool`, inputSchema: { type: 'object', properties: { message: { type: 'string' } } } });
const listCall: AppleToolCall = { type: 'tool.call', id: 'list', name: 'mcp_list_tools', server: 'local' };
const echoCall: AppleToolCall = { type: 'tool.call', id: 'call', name: 'mcp_call', server: 'local', tool: 'echo', arguments: '{"message":"hello"}' };
const mcpHarness = () => {
    let connections = 0;
    let closes = 0;
    const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
    let result: CallToolResult = { content: [{ type: 'text', text: 'Tool result' }] };
    const connectMcp: ConnectAppleMcp = async () => {
        connections++;
        return {
            list: async () => [tool('echo'), tool('fail'), tool('excluded')],
            call: async (name, args) => {
                calls.push({ name, args });
                return result;
            },
            close: async () => {
                closes++;
            }
        };
    };
    return {
        dependencies: { connectMcp, readConfig: async () => ({ local: configured }) },
        calls,
        setResult: (next: CallToolResult) => {
            result = next;
        },
        state: () => ({ connections, closes })
    };
};

describe('Apple web tool routing', () => {
    test('requires explicit search configuration without making a request', async () => {
        let requested = false;
        const request: AppleWebRequest = async () => {
            requested = true;
            throw new Error('Unexpected network call');
        };
        await expect(
            executeAppleNetworkTool('/project', { type: 'tool.call', id: 'search', name: 'web_search', query: 'question' }, undefined, context(), { request })
        ).rejects.toThrow('Configure BRAVE_SEARCH_API_KEY');
        expect(requested).toBe(false);
    });

    test('sends the Brave key only in the request header and returns bounded search results', async () => {
        let requestUrl = '';
        let requestHeaders: Record<string, string> | undefined;
        const request: AppleWebRequest = async (url, _signal, headers) => {
            requestUrl = url.href;
            requestHeaders = headers;
            return {
                url: url.href,
                status: 200,
                contentType: 'application/json',
                text: JSON.stringify({
                    web: {
                        results: Array.from({ length: 8 }, (_, index) => ({
                            title: `Result ${index}`,
                            url: `https://example.com/${index}`,
                            description: '🙂'.repeat(300)
                        }))
                    }
                })
            };
        };
        const result = await executeAppleNetworkTool(
            '/project',
            { type: 'tool.call', id: 'search', name: 'web_search', query: 'hello world' },
            undefined,
            context({ BRAVE_SEARCH_API_KEY: 'secret-test-key' }),
            { request }
        );
        expect(requestHeaders).toEqual({ 'X-Subscription-Token': 'secret-test-key' });
        expect(requestUrl).toContain('q=hello+world');
        expect(requestUrl).not.toContain('secret-test-key');
        expect(result.output).not.toContain('secret-test-key');
        expect(JSON.parse(result.output).results).toHaveLength(5);
        expect(JSON.parse(result.output).truncated).toBe(true);
        expect(Buffer.byteLength(result.output)).toBeLessThanOrEqual(6000);
    });

    test('uses the configured SearXNG endpoint and reports service failure', async () => {
        const urls: URL[] = [];
        const request: AppleWebRequest = async (url) => {
            urls.push(url);
            return { url: url.href, status: 403, contentType: 'application/json', text: '' };
        };
        await expect(
            executeAppleNetworkTool(
                '/project',
                { type: 'tool.call', id: 'search', name: 'web_search', query: 'query' },
                undefined,
                context({ SEARXNG_URL: 'https://search.example.com/search' }),
                { request }
            )
        ).rejects.toThrow('HTTP 403');
        expect(urls[0]?.searchParams.get('format')).toBe('json');
    });

    test('extracts page content and never returns a late canceled result', async () => {
        const controller = new AbortController();
        let complete!: (value: Awaited<ReturnType<AppleWebRequest>>) => void;
        const request: AppleWebRequest = () =>
            new Promise((resolve) => {
                complete = resolve;
            });
        const pending = executeAppleNetworkTool(
            '/project',
            { type: 'tool.call', id: 'fetch', name: 'fetch_page', url: 'https://example.com/page' },
            controller.signal,
            context(),
            { request }
        );
        controller.abort();
        complete({ url: 'https://example.com/page', status: 200, contentType: 'text/html', text: '<html><body><main>Late contents</main></body></html>' });
        await expect(pending).rejects.toThrow();
    });

    test('bounds escaped text without splitting UTF-8 characters', () => {
        const output = appleTextResult({ source: 'test' }, '\0🙂'.repeat(3000));
        expect(Buffer.byteLength(output)).toBeLessThanOrEqual(6000);
        expect(JSON.parse(output).truncated).toBe(true);
        expect(JSON.parse(output).content).not.toContain('\ufffd');
    });
});

describe('Apple configured MCP tools', () => {
    test('lists server names without starting a process or disclosing config secrets', async () => {
        const rig = mcpHarness();
        const result = await executeAppleNetworkTool(
            '/project',
            { type: 'tool.call', id: 'servers', name: 'mcp_list_tools' },
            undefined,
            context(),
            rig.dependencies
        );
        expect(JSON.parse(result.output).servers).toEqual(['local']);
        expect(result.output).not.toContain('configured-server');
        expect(rig.state().connections).toBe(0);
    });

    test('reuses one connection, filters allowed tools, and exposes a selected input schema', async () => {
        const rig = mcpHarness();
        const current = context();
        const listed = await executeAppleNetworkTool('/project', listCall, undefined, current, rig.dependencies);
        expect(JSON.parse(listed.output).tools.map((entry: { name: string }) => entry.name)).toEqual(['echo', 'fail']);
        const schema = await executeAppleNetworkTool('/project', { ...listCall, tool: 'echo' }, undefined, current, rig.dependencies);
        expect(JSON.parse(schema.output).inputSchema).toEqual(tool('echo').inputSchema);
        const called = await executeAppleNetworkTool('/project', echoCall, undefined, current, rig.dependencies);
        expect(called.failed).toBe(false);
        expect(rig.calls).toEqual([{ name: 'echo', args: { message: 'hello' } }]);
        expect(rig.state().connections).toBe(1);
        await closeAppleNetworkTools(current);
        expect(rig.state().closes).toBe(1);
    });

    test('refuses unconfigured, excluded, and malformed tool calls before execution', async () => {
        const rig = mcpHarness();
        const current = context();
        for (const call of [
            { ...echoCall, server: 'unknown' },
            { ...echoCall, tool: 'excluded' },
            { ...echoCall, arguments: '[]' },
            { ...echoCall, arguments: '{invalid' }
        ]) {
            await expect(executeAppleNetworkTool('/project', call, undefined, current, rig.dependencies)).rejects.toThrow();
        }
        expect(rig.calls).toHaveLength(0);
    });

    test('propagates tool errors and marks unsupported media rather than claiming success', async () => {
        const rig = mcpHarness();
        rig.setResult({
            isError: true,
            content: [
                { type: 'text', text: 'Service rejected the operation' },
                { type: 'image', mimeType: 'image/png', data: 'AA==' }
            ],
            structuredContent: { reason: 'denied' }
        });
        const result = await executeAppleNetworkTool('/project', echoCall, undefined, context(), rig.dependencies);
        expect(result.failed).toBe(true);
        expect(JSON.parse(result.output).isError).toBe(true);
        expect(JSON.parse(result.output).content).toContain('Service rejected');
        expect(JSON.parse(result.output).content).toContain('image content omitted');
        expect(JSON.parse(result.output).content).toContain('"reason":"denied"');
    });

    test('aborted MCP results never return to the model', async () => {
        const controller = new AbortController();
        let complete!: (result: CallToolResult) => void;
        let called!: () => void;
        const started = new Promise<void>((resolve) => {
            called = resolve;
        });
        const current = context();
        const pending = executeAppleNetworkTool('/project', echoCall, controller.signal, current, {
            readConfig: async () => ({ local: configured }),
            connectMcp: async () => ({
                list: async () => [tool('echo')],
                call: async () => {
                    called();
                    return new Promise((resolve) => {
                        complete = resolve;
                    });
                },
                close: async () => undefined
            })
        });
        await started;
        controller.abort();
        complete({ content: [{ type: 'text', text: 'Late private data' }] });
        await expect(pending).rejects.toThrow();
    });

    test('configuration loads only enabled servers and expands explicitly named account variables', async () => {
        const home = await mkdtemp(join(tmpdir(), 'ruimte-apple-mcp-config-'));
        folders.push(home);
        await writeFile(
            join(home, 'apple-mcp.json'),
            JSON.stringify({
                mcpServers: { enabled: { command: 'server', env: { TOKEN: '${TEST_TOKEN}' } }, disabled: { command: 'disabled', enabled: false } }
            })
        );
        const config = await readAppleMcpConfig(home);
        expect(Object.keys(config)).toEqual(['enabled']);
        expect(expandMcpEnvironment({ TOKEN: '${TEST_TOKEN}', STATIC: 'literal' }, { TEST_TOKEN: 'secret' })).toEqual({ TOKEN: 'secret', STATIC: 'literal' });
        expect(() => expandMcpEnvironment({ TOKEN: '${MISSING_TOKEN}' }, {})).toThrow('MISSING_TOKEN');
    });

    test('a changed configuration closes the old connection before reconnecting', async () => {
        const seen: string[] = [];
        const pool = new AppleMcpPool(async (config) => {
            const name = 'command' in config ? config.command : config.url;
            seen.push(`connect:${name}`);
            return {
                list: async () => [],
                call: async () => ({ content: [] }),
                close: async () => {
                    seen.push(`close:${name}`);
                }
            };
        });
        try {
            await pool.get('local', configured, '/project', {}, new AbortController().signal);
            await pool.get('local', { ...configured, command: 'changed' }, '/project', {}, new AbortController().signal);
            expect(seen).toEqual(['connect:configured-server', 'close:configured-server', 'connect:changed']);
        } finally {
            await pool.close();
        }
    });

    test('closing during connection startup closes the eventual connection', async () => {
        let complete!: (connection: AppleMcpConnection) => void;
        let closed = 0;
        const pool = new AppleMcpPool(
            () =>
                new Promise((resolve) => {
                    complete = resolve;
                })
        );
        const pending = pool.get('local', configured, '/project', {}, new AbortController().signal);
        const closing = pool.close();
        complete({
            list: async () => [],
            call: async () => ({ content: [] }),
            close: async () => {
                closed++;
            }
        });
        await expect(pending).rejects.toThrow('closed');
        await closing;
        expect(closed).toBeGreaterThan(0);
    });
});

describe('Apple MCP connection recovery', () => {
    test('an aborted connection is evicted before the next request', async () => {
        let complete!: (connection: AppleMcpConnection) => void;
        let connections = 0;
        let closes = 0;
        const connection: AppleMcpConnection = {
            list: async () => [],
            call: async () => ({ content: [] }),
            close: async () => {
                closes++;
            }
        };
        const pool = new AppleMcpPool(async () => {
            connections++;
            return connections === 1
                ? new Promise((resolve) => {
                      complete = resolve;
                  })
                : connection;
        });
        const controller = new AbortController();
        try {
            const pending = pool.get('local', configured, '/project', {}, controller.signal);
            controller.abort();
            complete(connection);
            await expect(pending).rejects.toThrow();
            await pool.get('local', configured, '/project', {}, new AbortController().signal);
            expect(connections).toBe(2);
            expect(closes).toBe(1);
        } finally {
            await pool.close();
        }
    });

    test('a transport failure closes the client without replaying the call; a later request reconnects', async () => {
        let connections = 0;
        let calls = 0;
        let closes = 0;
        const dependencies = {
            readConfig: async () => ({ local: configured }),
            connectMcp: async (): Promise<AppleMcpConnection> => {
                connections++;
                return {
                    list: async () => [tool('echo')],
                    call: async () => {
                        calls++;
                        if (calls === 1) {
                            throw new Error('Disconnected');
                        }
                        return { content: [{ type: 'text', text: 'Recovered' }] };
                    },
                    close: async () => {
                        closes++;
                    }
                };
            }
        };
        const current = context();
        await expect(executeAppleNetworkTool('/project', echoCall, undefined, current, dependencies)).rejects.toThrow('Disconnected');
        expect({ connections, calls, closes }).toEqual({ connections: 1, calls: 1, closes: 1 });
        expect((await executeAppleNetworkTool('/project', echoCall, undefined, current, dependencies)).failed).toBe(false);
        expect({ connections, calls }).toEqual({ connections: 2, calls: 2 });
    });
});
