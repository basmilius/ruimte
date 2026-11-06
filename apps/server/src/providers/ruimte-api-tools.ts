import type { ApiHostTools, ApiToolDefinition, BackendHost, BackendLaunch } from '@adecore/agents/chat';
import { cliMcpHeaders } from '@adecore/agents/providers';
import type { Tool } from '@modelcontextprotocol/client';
import { bestEffort } from '../best-effort.ts';
import { errorText } from '../error-text.ts';
import { MCP_SERVER } from '../ruimte-mcp.ts';
import { connectApiMcp, mcpResultText, RUIMTE_MCP_LIMITS, type ApiHttpMcpServer, type ApiMcpConnection, type ConnectApiMcp } from './api-mcp.ts';

// The name the model and the thread give a tool of Ruimte's MCP server, the one Claude Code gives it too.
const RUIMTE_TOOL_PREFIX = `mcp__${MCP_SERVER}__`;

// Connecting and listing happen once per backend, apart from any turn, so a stopped turn does not lose the tools.
const RUIMTE_CONNECT_TIMEOUT_MS = 20_000;

interface Connected {
    connection: ApiMcpConnection;
    tools: Tool[];
}

/*
 * The tools of Ruimte's MCP server for a chat on a plain API, beside its project tools. They run without a card in every
 * mode, since the daemon checks each call itself. A chat the daemon gave no token gets none, and one that cannot reach
 * the server gets a note and runs on the project tools alone.
 */
export function ruimteApiTools(launch: BackendLaunch, host: BackendHost, connectMcp: ConnectApiMcp = connectApiMcp): ApiHostTools | null {
    const ruimte = launch.mcpServers?.find((candidate) => candidate.name === MCP_SERVER);

    if (ruimte === undefined || ruimte.tokenVariable === undefined) {
        return null;
    }

    const server: ApiHttpMcpServer = { type: 'http', url: ruimte.url, headers: cliMcpHeaders(ruimte.tokenVariable) };

    let connected: Promise<Connected | null> | null = null;

    const connect = (): Promise<Connected | null> =>
        (connected ??= (async () => {
            const signal = AbortSignal.timeout(RUIMTE_CONNECT_TIMEOUT_MS);

            try {
                const connection = await connectMcp(server, launch.env, signal, RUIMTE_MCP_LIMITS);

                return { connection, tools: await connection.list(signal) };
            } catch (error) {
                host.onEvent({ type: 'note', level: 'warning', text: `Ruimte's tools are unavailable in this chat: ${errorText(error)}` });

                return null;
            }
        })());

    return {
        definitions: async (): Promise<ApiToolDefinition[]> =>
            ((await connect())?.tools ?? []).map((tool) => ({
                name: `${RUIMTE_TOOL_PREFIX}${tool.name}`,
                description: tool.description ?? '',
                parameters: tool.inputSchema as Record<string, unknown>
            })),
        run: async (name, input, signal) => {
            const ruimte = await connect();
            const tool = name.slice(RUIMTE_TOOL_PREFIX.length);

            if (ruimte === null || !name.startsWith(RUIMTE_TOOL_PREFIX) || !ruimte.tools.some((entry) => entry.name === tool)) {
                return { output: 'Invalid or unsupported tool arguments.', failed: true };
            }

            const result = await ruimte.connection.call(tool, input, signal);

            return { output: mcpResultText(result), failed: result.isError === true };
        },
        close: async () => {
            const ruimte = await connected?.catch(() => null);
            await bestEffort('ruimte.connection.close', ruimte?.connection.close());
        }
    };
}
