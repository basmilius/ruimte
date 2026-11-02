import { Server, WebStandardStreamableHTTPServerTransport, type CallToolResult } from '@modelcontextprotocol/server';
import { bearerCaller } from '../agents/bearer.ts';
import { callerKind } from '../canvas/tasks.ts';
import { VerbRefusal, type CanvasHost } from '../canvas/verb.ts';
import { errorText } from '../error-text.ts';
import { ProjectError } from '../projects/project-error.ts';
import { VERSION } from '../version.ts';
import { catalog, catalogNames, withToolNames, type Tool, type ToolContext } from './catalog.ts';
import { withFieldNames } from './fields.ts';
import { AgentFiles } from './files.ts';
import { MCP_INSTRUCTIONS } from './instructions.ts';
import type { ArtifactUploads } from './uploads.ts';

export { MCP_PATH } from '../providers/ruimte-mcp.ts';

/* The largest picture a tool hands back as image content; a larger one is still named by its path. */
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;

export interface McpDeps {
    /* The session or chat a bearer token speaks for. */
    targetForToken(token: string): string | null;
    host: CanvasHost;
    uploads?: ArtifactUploads;
    /* The caller's own folders under `$RUIMTE_HOME` (its attachments and visuals), from which its files may come too. */
    callerFolders?(caller: string): string[];
}

/* The tools this caller sees: the chat tools only for an AI chat, computer use while it is on, databases where the project has a connection. */
export async function visibleTools(caller: string, host: CanvasHost): Promise<Tool[]> {
    const place = host.projects.locate(caller);
    const kind = (place === null ? null : callerKind(await host.projects.read(place.projectId), caller)) ?? host.hiddenAgents?.get(caller)?.node.kind ?? null;
    const databases = place === null || host.databases === undefined ? [] : await host.databases.list(place).catch(() => []);
    const shown = {
        everyone: true,
        chat: kind === 'chat',
        computer: host.computer?.enabled === true,
        database: databases.length > 0
    };

    return catalog().filter((tool) => shown[tool.audience]);
}

/* A refusal as a model reads it: the code and sentence first, then only what the call would accept, without pointers to CLI help. */
export function refusalResult(code: string, message: string, lines: readonly string[]): CallToolResult {
    const names = catalogNames();
    const said = (text: string): string => withFieldNames(withToolNames(text, names));
    const kept = lines.filter((line) => !line.startsWith('usage\t') && !(line.startsWith('detail\t') && /\bhelp\b/.test(line))).map(said);

    return { isError: true, content: [{ type: 'text', text: [`refused ${code}: ${said(message)}`, ...kept].join('\n') }] };
}

async function imageContent(path: string): Promise<CallToolResult['content'][number] | null> {
    const file = Bun.file(path);

    if (!(await file.exists()) || file.size > MAX_IMAGE_BYTES) {
        return null;
    }

    return { type: 'image', data: Buffer.from(await file.arrayBuffer()).toString('base64'), mimeType: 'image/png' };
}

/* Runs one tool for the caller; every refusal becomes an error result, and only a tool that broke is logged. */
export async function callTool(tools: readonly Tool[], name: string, input: Readonly<Record<string, unknown>>, context: ToolContext): Promise<CallToolResult> {
    const tool = tools.find((candidate) => candidate.name === name);

    if (tool === undefined) {
        return refusalResult('unknown-tool', `${name} is not a tool this session has`, []);
    }

    try {
        const outcome = await tool.run(input, context);
        const images = await Promise.all(outcome.images.map(imageContent));

        return {
            content: [{ type: 'text', text: outcome.lines.join('\n') }, ...images.filter((image): image is NonNullable<typeof image> => image !== null)]
        };
    } catch (e) {
        if (e instanceof VerbRefusal) {
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
            throw new VerbRefusal('not-in-project', 'This session is not a node or a view of any project on this machine');
        }

        return AgentFiles.of(place.folder, await deps.host.checkouts.paths(place.folder), deps.callerFolders?.(caller) ?? []);
    };

    return {
        caller,
        host: deps.host,
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
    const caller = bearerCaller(request, deps.targetForToken);

    if (caller === null) {
        return new Response('Unknown token', { status: 401 });
    }

    const server = new Server({ name: 'ruimte', version: VERSION }, { capabilities: { tools: {} }, instructions: MCP_INSTRUCTIONS });

    server.setRequestHandler('tools/list', async () => ({
        tools: (await visibleTools(caller, deps.host)).map((tool) => ({
            name: tool.name,
            description: tool.description,
            inputSchema: tool.inputSchema,
            annotations: tool.annotations
        }))
    }));

    server.setRequestHandler('tools/call', async (call) =>
        callTool(await visibleTools(caller, deps.host), call.params.name, call.params.arguments ?? {}, toolContext(caller, deps))
    );

    const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
    await server.connect(transport);

    return transport.handleRequest(request);
}
