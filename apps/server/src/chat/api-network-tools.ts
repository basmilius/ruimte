import { homedir } from 'node:os';
import { join } from 'node:path';
import { isRecord } from '@adecore/utils/record';
import type { Tool } from '@modelcontextprotocol/client';
import { ApiMcpPool, mcpResultText, readApiMcpConfig, type ConnectApiMcp } from './api-mcp.ts';
import { extractApiPage, limitApiText, publicWebUrl, requestPublicWeb, type ApiWebRequest } from './api-web.ts';

interface NetworkCallBase {
    type: 'tool.call';
    id: string;
}

export type ApiNetworkToolCall = NetworkCallBase &
    (
        | { name: 'web_search'; query: string }
        | { name: 'fetch_page'; url: string }
        | { name: 'mcp_list_tools'; server?: string; tool?: string }
        | { name: 'mcp_call'; server: string; tool: string; arguments: string }
    );

export interface ApiToolContext {
    env: Record<string, string>;
    home: string;
}

interface ApiToolResult {
    output: string;
    failed: boolean;
}

interface NetworkDependencies {
    request?: ApiWebRequest;
    connectMcp?: ConnectApiMcp;
    readConfig?: typeof readApiMcpConfig;
}

const pools = new WeakMap<ApiToolContext, ApiMcpPool>();
const fallbackContext: ApiToolContext = { env: process.env as Record<string, string>, home: process.env.RUIMTE_HOME ?? join(homedir(), '.ruimte') };

export async function closeApiNetworkTools(context: ApiToolContext): Promise<void> {
    const pool = pools.get(context);
    pools.delete(context);
    await pool?.close();
}

function boundedJson(value: unknown): string {
    const text = JSON.stringify(value);
    if (Buffer.byteLength(text) > 6000) {
        throw new Error('The result does not fit the local context. Request a narrower result.');
    }
    return text;
}

export function apiTextResult(metadata: Record<string, unknown>, value: string): string {
    let budget = 5200;
    while (budget >= 0) {
        const clipped = limitApiText(value, budget);
        const output = JSON.stringify({ ...metadata, content: clipped.text, truncated: clipped.truncated });
        if (Buffer.byteLength(output) <= 6000) {
            return output;
        }
        budget -= 200;
    }
    throw new Error('The result metadata exceeds the local context limit.');
}

function toolListing(server: string, tools: Tool[]): string {
    const entries: Array<{ name: string; description: string }> = [];
    for (const tool of tools.slice(0, 40)) {
        const entry = { name: tool.name, description: limitApiText(tool.description ?? '', 180).text };
        if (Buffer.byteLength(JSON.stringify({ server, tools: [...entries, entry], truncated: true })) > 5800) {
            break;
        }
        entries.push(entry);
    }
    return boundedJson({
        server,
        tools: entries,
        truncated: entries.length < tools.length,
        next: 'Call MCPListTools with server and tool to inspect one input schema.'
    });
}

export async function executeApiNetworkTool(
    cwd: string,
    call: ApiNetworkToolCall,
    signal?: AbortSignal,
    context: ApiToolContext = fallbackContext,
    dependencies: NetworkDependencies = {}
): Promise<ApiToolResult> {
    signal?.throwIfAborted();
    const deadline = AbortSignal.timeout(30_000);
    const active = signal ? AbortSignal.any([signal, deadline]) : deadline;
    const request = dependencies.request ?? requestPublicWeb;
    if (call.name === 'fetch_page') {
        const page = await request(publicWebUrl(call.url), active);
        // Before the parser, which is loaded on first use and takes seconds on a busy machine.
        active.throwIfAborted();
        const result = await extractApiPage(page);
        active.throwIfAborted();
        return { output: apiTextResult({ url: page.url, title: limitApiText(result.title, 300).text }, result.text), failed: false };
    }
    if (call.name === 'web_search') {
        const key = context.env.BRAVE_SEARCH_API_KEY;
        const endpoint = context.env.SEARXNG_URL;
        if (!key && !endpoint) {
            throw new Error('Configure BRAVE_SEARCH_API_KEY as a sensitive Api account variable, or SEARXNG_URL for your search service.');
        }
        const url = publicWebUrl(key ? 'https://api.search.brave.com/res/v1/web/search' : endpoint!);
        url.searchParams.set('q', call.query);
        url.searchParams.set(key ? 'count' : 'format', key ? '5' : 'json');
        const page = await request(url, active, key ? { 'X-Subscription-Token': key } : undefined);
        if (page.status !== 200) {
            throw new Error(`The search service returned HTTP ${page.status}. Check the Api account search configuration.`);
        }
        const json = JSON.parse(page.text);
        const raw: unknown = key ? json.web?.results : json.results;
        if (!Array.isArray(raw)) {
            throw new Error('The search service returned an unexpected response.');
        }
        const results = raw.slice(0, 5).map((item: Record<string, unknown>) => ({
            title: limitApiText(typeof item.title === 'string' ? item.title : '', 200).text,
            url: typeof item.url === 'string' ? item.url.slice(0, 1000) : '',
            description: limitApiText(typeof (item.description ?? item.content) === 'string' ? String(item.description ?? item.content) : '', 500).text
        }));
        while (results.length && Buffer.byteLength(JSON.stringify({ results })) > 5800) {
            results.pop();
        }
        active.throwIfAborted();
        return { output: boundedJson({ results, truncated: results.length < raw.length }), failed: false };
    }
    if (call.name !== 'mcp_list_tools' && call.name !== 'mcp_call') {
        throw new Error('This is not a network tool.');
    }
    const config = await (dependencies.readConfig ?? readApiMcpConfig)(context.home, active);
    if (!call.server) {
        return { output: boundedJson({ servers: Object.keys(config), next: 'Call MCPListTools with a server name.' }), failed: false };
    }
    const server = config[call.server];
    if (!server) {
        throw new Error('This MCP server is not configured or is disabled in api-mcp.json.');
    }
    let pool = pools.get(context);
    if (!pool) {
        pool = new ApiMcpPool(dependencies.connectMcp);
        pools.set(context, pool);
    }
    const connection = await pool.get(call.server, server, cwd, context.env, active);
    const runMcp = async <T>(work: () => Promise<T>): Promise<T> => {
        try {
            return await work();
        } catch (error) {
            await pool.invalidate(call.server!, connection);
            active.throwIfAborted();
            throw error;
        }
    };
    const tools = (await runMcp(() => connection.list(active))).filter((tool) => !server.allowedTools || server.allowedTools.includes(tool.name));
    active.throwIfAborted();
    if (call.name === 'mcp_list_tools') {
        if (call.tool) {
            const selected = tools.find((tool) => tool.name === call.tool);
            if (!selected) {
                throw new Error('The requested MCP tool is unavailable or excluded by allowedTools.');
            }
            return {
                output: boundedJson({ server: call.server, name: selected.name, description: selected.description, inputSchema: selected.inputSchema }),
                failed: false
            };
        }
        return { output: toolListing(call.server, tools), failed: false };
    }
    if (!tools.some((tool) => tool.name === call.tool)) {
        throw new Error('The requested MCP tool is unavailable or excluded by allowedTools.');
    }
    const args: unknown = JSON.parse(call.arguments);
    if (!isRecord(args)) {
        throw new Error('MCP arguments must be a JSON object.');
    }
    const result = await runMcp(() => connection.call(call.tool, args, active));
    active.throwIfAborted();
    return {
        output: apiTextResult({ server: call.server, tool: call.tool, isError: result.isError === true }, mcpResultText(result)),
        failed: result.isError === true
    };
}
