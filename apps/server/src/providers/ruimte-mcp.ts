import type { BackendLaunch } from '@adecore/agents/chat';
import type { AgentKind } from '@ruimte/contracts';

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

export interface McpEndpoint {
    readonly url: string;
    readonly tokenVariable: string;
}

/* The MCP endpoint of the daemon whose context URL this is, over the same loopback port. */
export function mcpUrlOf(contextUrl: string): string {
    return new URL(MCP_PATH, contextUrl).href;
}

function bearerHeader(endpoint: McpEndpoint): Record<string, string> {
    return { Authorization: `Bearer \${${endpoint.tokenVariable}}` };
}

/*
 * A terminal's line. Claude Code expands `${VAR}` in a config's headers, also under `--strict-mcp-config` (measured
 * on 2.1.316). The `=` form matters, since the flag is variadic and would swallow the argument after it.
 */
function claudeMcpArgs(endpoint: McpEndpoint): string[] {
    const config = { mcpServers: { [MCP_SERVER]: { type: 'http', url: endpoint.url, headers: bearerHeader(endpoint) } } };

    return [`--mcp-config=${JSON.stringify(config)}`];
}

/*
 * Codex reads the token from the variable it names, and `approve` runs every tool without an elicitation, the way
 * Claude Code's allow rule does: the daemon checks each call itself (measured on Codex 0.164). A JSON string is a
 * valid TOML basic string.
 */
export function codexMcpArgs(endpoint: McpEndpoint): string[] {
    const server = `mcp_servers.${MCP_SERVER}`;

    return [
        '-c',
        `${server}.url=${JSON.stringify(endpoint.url)}`,
        '-c',
        `${server}.bearer_token_env_var=${JSON.stringify(endpoint.tokenVariable)}`,
        '-c',
        `${server}.default_tools_approval_mode="approve"`
    ];
}

// Copilot expands `${VAR}` in headers but refuses it in a URL, so the URL is literal (measured on Copilot CLI 1.0.104).
export function copilotMcpArgs(endpoint: McpEndpoint): string[] {
    const config = { mcpServers: { [MCP_SERVER]: { type: 'http', url: endpoint.url, headers: bearerHeader(endpoint), tools: ['*'] } } };

    return [`--additional-mcp-config=${JSON.stringify(config)}`];
}

// Every tool of the server runs without a prompt, in every mode: the daemon enforces each call (mode ceiling, depth, cwd).
export const CLAUDE_ALLOW_MCP = `mcp__${MCP_SERVER}`;
export const COPILOT_ALLOW_MCP = `--allow-tool=${MCP_SERVER}`;

const MCP_ARGS: Partial<Record<AgentKind, (endpoint: McpEndpoint) => string[]>> = {
    claude: claudeMcpArgs,
    codex: codexMcpArgs,
    copilot: copilotMcpArgs
};

/* What a CLI of this kind takes on its line to load the server; a CLI without a flag for it gets nothing. */
export function mcpArgs(kind: AgentKind, endpoint: McpEndpoint): string[] {
    return MCP_ARGS[kind]?.(endpoint) ?? [];
}

/*
 * A chat's launch with the server in it, every tool allowed. An ACP agent loads it from its session request and
 * expands no variable, so its header carries the chat's token itself, over the agent's stdio and never on its line.
 * Claude Code gets its servers on its line and expands `${VAR}` there, so it gets the `variable` header instead.
 * A chat the daemon gave no token starts without it.
 */
export function withRuimteMcp(launch: BackendLaunch, token: 'inline' | 'variable' = 'inline'): BackendLaunch {
    const url = launch.env[MCP_URL_VARIABLE];
    const value = launch.env[CHAT_TOKEN_VARIABLE];

    if (url === undefined || value === undefined) {
        return launch;
    }

    const headers = token === 'inline' ? { Authorization: `Bearer ${value}` } : bearerHeader({ url, tokenVariable: CHAT_TOKEN_VARIABLE });
    const server = { name: MCP_SERVER, url, headers, allowTools: true };

    return { ...launch, mcpServers: [...(launch.mcpServers ?? []), server] };
}
