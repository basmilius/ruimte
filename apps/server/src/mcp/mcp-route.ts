import { ToolRefusal } from '@adecore/agents/context';
import { Server, WebStandardStreamableHTTPServerTransport, type CallToolResult } from '@modelcontextprotocol/server';
import type { ServerActions } from '../actions/server-actions.ts';
import { AgentFiles } from '../agent-files/files.ts';
import type { ArtifactUploads } from '../agent-files/uploads.ts';
import type { CanvasHost } from '../canvas/host.ts';
import { callerKind } from '../canvas/tasks.ts';
import { errorText } from '../error-text.ts';
import { ProjectError } from '../projects/project-error.ts';
import { MCP_MAX_IMAGE_BYTES } from '../ruimte-mcp.ts';
import { VERSION } from '../version.ts';
import { callerOf } from './caller.ts';
import type { Tool, ToolContext } from './catalog.ts';
import { MCP_INSTRUCTIONS } from './instructions.ts';

export { MCP_PATH, MCP_REQUEST_TIMEOUT_S } from '../ruimte-mcp.ts';

interface McpDeps {
    /* The session or chat a bearer token speaks for. */
    targetForToken(token: string): string | null;
    host: CanvasHost;
    actions: ServerActions;
    /* Every tool of the daemon, which `buildCatalog` made from its features. */
    tools: readonly Tool[];
    uploads?: ArtifactUploads;
    /* The caller's own folders under `$RUIMTE_HOME` (its attachments and visuals), from which its files may come too. */
    callerFolders?(caller: string): string[];
    /* The folders the machine keeps the shots it takes in, from which a picture a tool hands back may come too. */
    shotFolders?: readonly string[];
}

/* The tools this caller sees: the chat tools only for an AI chat, computer use while it is on, databases where the project has a connection. */
export async function visibleTools(caller: string, host: CanvasHost, tools: readonly Tool[]): Promise<Tool[]> {
    const place = host.projects.locate(caller);
    const kind = (place === null ? null : callerKind(await host.projects.read(place.projectId), caller)) ?? host.hiddenAgents?.get(caller)?.node.kind ?? null;
    const databases = place === null || host.databases === undefined ? [] : await host.databases.list(place).catch(() => []);
    const shown = {
        everyone: true,
        chat: kind === 'chat',
        computer: host.computer?.enabled === true,
        database: databases.length > 0
    };

    return tools.filter((tool) => shown[tool.audience]);
}

/* A refusal as a model reads it: the code and sentence first, then only what the call would accept. */
export function refusalResult(code: string, message: string, lines: readonly string[]): CallToolResult {
    return { isError: true, content: [{ type: 'text', text: [`refused ${code}: ${message}`, ...lines].join('\n') }] };
}

/* The pngs a tool handed back, each read only inside the folders a picture of this caller may come from. */
async function imageContents(paths: readonly string[], context: ToolContext): Promise<CallToolResult['content']> {
    if (paths.length === 0) {
        return [];
    }

    const files = await context.files();
    const pictures = await Promise.all(paths.map((path) => files.picture(path, MCP_MAX_IMAGE_BYTES)));

    return pictures
        .filter((bytes): bytes is Buffer => bytes !== null)
        .map((bytes) => ({ type: 'image' as const, data: bytes.toString('base64'), mimeType: 'image/png' }));
}

/* Runs one tool for the caller; every refusal becomes an error result, and only a tool that broke is logged. */
export async function callTool(tools: readonly Tool[], name: string, input: Readonly<Record<string, unknown>>, context: ToolContext): Promise<CallToolResult> {
    const tool = tools.find((candidate) => candidate.name === name);

    if (tool === undefined) {
        return refusalResult('unknown-tool', `${name} is not a tool this session has`, []);
    }

    try {
        const outcome = await tool.run(input, context);
        const images = await imageContents(outcome.images, context);

        return { content: [{ type: 'text', text: outcome.lines.join('\n') }, ...images] };
    } catch (e) {
        if (e instanceof ToolRefusal) {
            return refusalResult(e.code, e.message, e.lines);
        }

        if (e instanceof ProjectError) {
            return refusalResult(e.code, e.message, []);
        }

        console.error(`MCP tool ${name} failed:`, errorText(e));

        return { isError: true, content: [{ type: 'text', text: `The tool failed: ${errorText(e)}` }] };
    }
}

function toolContext(caller: string, deps: McpDeps): ToolContext {
    let files: Promise<AgentFiles> | null = null;

    const folders = async (): Promise<AgentFiles> => {
        const place = deps.host.projects.locate(caller);

        if (place === null) {
            throw new ToolRefusal('not-in-project', 'This session is not a node or a view of any project on this machine');
        }

        return AgentFiles.of(place.folder, await deps.host.checkouts.paths(place.folder), deps.callerFolders?.(caller) ?? [], deps.shotFolders);
    };

    return {
        caller,
        host: deps.host,
        actions: deps.actions,
        uploads: deps.uploads,
        files: () => {
            files ??= folders();

            return files;
        }
    };
}

/*
 * `/mcp`, Streamable HTTP in stateless mode: a fresh server per request, and the caller is the
 * bearer token on every request, never a session id.
 */
export async function handleMcpRequest(request: Request, deps: McpDeps): Promise<Response> {
    const identity = callerOf(request, deps.targetForToken);

    if (identity === null) {
        return new Response('Unknown token', { status: 401 });
    }

    const caller = identity.id;
    const server = new Server({ name: 'ruimte', version: VERSION }, { capabilities: { tools: {} }, instructions: MCP_INSTRUCTIONS });

    server.setRequestHandler('tools/list', async () => ({
        tools: (await visibleTools(caller, deps.host, deps.tools)).map((tool) => ({
            name: tool.name,
            description: tool.description,
            inputSchema: tool.inputSchema,
            annotations: tool.annotations
        }))
    }));

    server.setRequestHandler('tools/call', async (call) =>
        callTool(await visibleTools(caller, deps.host, deps.tools), call.params.name, call.params.arguments ?? {}, toolContext(caller, deps))
    );

    const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
    await server.connect(transport);

    return transport.handleRequest(request);
}
