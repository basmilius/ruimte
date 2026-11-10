import type { ChatMcpServer } from '@adecore/agents/chat';
import type { CliMcpServer, LaunchDecorator } from '@adecore/agents/providers';

/*
 * How an agent Ruimte starts reaches the daemon's MCP server: one HTTP server named `ruimte` on the
 * daemon's loopback port, with the caller's bearer token read from the environment by the CLI itself, so
 * the token never sits on a command line a person can read back.
 */
export const MCP_SERVER = 'ruimte';
export const MCP_PATH = '/mcp';

/*
 * How long a tool call may take before the server drops it, in seconds. Bun ends a request after 10 s of
 * silence, and a computer tool may hold 110 s for a card or a pause and then wait 110 s for its window.
 */
export const MCP_REQUEST_TIMEOUT_S = 240;

/* The largest picture a tool hands back as image content; a larger one is still named by its path. */
export const MCP_MAX_IMAGE_BYTES = 10 * 1024 * 1024;

// Where the token sits: a chat gets its own per load, a terminal its hook token.
export const CHAT_TOKEN_VARIABLE = 'RUIMTE_CONTEXT_TOKEN';
export const TERMINAL_TOKEN_VARIABLE = 'RUIMTE_HOOK_TOKEN';

// Where a backend that runs inside the daemon (Apple, the API providers, an ACP agent's session request, a Claude chat's launch) finds the server.
export const MCP_URL_VARIABLE = 'RUIMTE_MCP_URL';

/* The MCP endpoint of the daemon whose context URL this is, over the same loopback port. */
export function mcpUrlOf(contextUrl: string): string {
    return new URL(MCP_PATH, contextUrl).href;
}

export function ruimteCliMcp(contextUrl: string, tokenVariable: string): CliMcpServer {
    return { name: MCP_SERVER, url: mcpUrlOf(contextUrl), tokenVariable };
}

/*
 * The one addition Ruimte makes to the launch of a chat, on every provider: its server with every tool allowed and
 * the chat's token named by variable, which each backend hands to its CLI in the form the CLI reads. A chat the
 * daemon gave no token starts without it.
 */
export const withRuimteMcp: LaunchDecorator = (launch) => {
    const url = launch.env[MCP_URL_VARIABLE];

    if (url === undefined || launch.env[CHAT_TOKEN_VARIABLE] === undefined) {
        return launch;
    }

    const server: ChatMcpServer = { name: MCP_SERVER, url, tokenVariable: CHAT_TOKEN_VARIABLE, allowTools: true };

    return { ...launch, mcpServers: [...(launch.mcpServers ?? []), server] };
};
