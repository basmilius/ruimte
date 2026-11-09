import { ToolRefusal } from '@adecore/agents/context';
import { cancellableTimeout } from '@adecore/utils/async';
import { Server, WebStandardStreamableHTTPServerTransport, type CallToolResult } from '@modelcontextprotocol/server';
import type { Credential } from '@ruimte/contracts';
import type { ServerActions } from '../actions/server-actions.ts';
import { AgentFiles } from '../agent-files/files.ts';
import type { ArtifactUploads } from '../agent-files/uploads.ts';
import { externalActorId, type ExternalCaller } from '../canvas/external-caller.ts';
import type { CanvasHost } from '../canvas/host.ts';
import { externalPlace } from '../tools/external-reach.ts';
import type { Tool as KitTool } from '../tools/tool.ts';
import { VERSION } from '../version.ts';
import type { Tool, ToolContext } from './catalog.ts';
import { visibleExternalTools } from './external-catalog.ts';
import { EXTERNAL_INSTRUCTIONS } from './external-instructions.ts';
import { MACHINE_WIDE_TOOLS } from './external-tiers.ts';
import { callTool, refusalResult } from './mcp-route.ts';

/* Cloudflare cuts proxied traffic that reads nothing for 125 seconds, so a tool answers before that or hands back what to poll. */
export const EXTERNAL_TOOL_BUDGET_MS = 100_000;

export interface ExternalMcpDeps {
    host: CanvasHost;
    actions: ServerActions;
    /* Every tool of the daemon, which `buildCatalog` made from its features. */
    tools: readonly Tool[];
    uploads?: ArtifactUploads;
    callerFolders?(caller: string): string[];
    shotFolders?: readonly string[];
    /* Tools beyond the catalog's, such as the approval tools. */
    extraTools?: readonly KitTool[];
    budgetMs?: number;
}

/* `client` is the name a person reads for it, from the credential store's check. */
export function externalCallerOf(credential: Credential, client: string): ExternalCaller {
    return { kind: 'external', id: externalActorId(credential.id), credentialId: credential.id, label: client, grant: credential.grant };
}

function slowResult(name: string): CallToolResult {
    return {
        content: [
            {
                type: 'text',
                text: `${name} is still running. It was not stopped: poll operation_get or task_list for the outcome, and do not call it again until you know it did not finish.`
            }
        ]
    };
}

/*
 * Runs one tool for a client elsewhere. `project` is answered here, against the scope on the credential, at every call;
 * the tool then works in that project's place and never learns the field.
 */
export async function callExternalTool(
    tools: readonly Tool[],
    caller: ExternalCaller,
    name: string,
    raw: Readonly<Record<string, unknown>>,
    deps: ExternalMcpDeps
): Promise<CallToolResult> {
    const tool = tools.find((candidate) => candidate.name === name);

    if (tool === undefined) {
        return refusalResult('unknown-tool', `${name} is not a tool this credential has`, []);
    }

    const { project, ...input } = raw;
    let reached: ToolContext['reached'];

    if (!MACHINE_WIDE_TOOLS.has(name)) {
        if (typeof project !== 'string' || project === '') {
            return refusalResult('bad-arguments', `${name} needs project, the id of a project; project_list lists them`, []);
        }

        try {
            reached = await externalPlace(deps.host, caller.grant, project);
        } catch (e) {
            if (e instanceof ToolRefusal) {
                return refusalResult(e.code, e.message, e.lines);
            }

            throw e;
        }
    }

    let files: Promise<AgentFiles> | null = null;
    const context: ToolContext = {
        caller: caller.id,
        host: deps.host,
        actions: deps.actions,
        external: caller,
        ...(reached === undefined ? {} : { reached }),
        uploads: deps.uploads,
        files: () => {
            files ??= (async () => {
                if (reached === undefined) {
                    throw new ToolRefusal('bad-arguments', `${name} works in a project; give project`);
                }

                return AgentFiles.of(reached.folder, await deps.host.checkouts.paths(reached.folder), deps.callerFolders?.(caller.id) ?? [], deps.shotFolders);
            })();

            return files;
        }
    };

    const running = callTool(tools, name, input, context);

    return new Promise<CallToolResult>((resolve, reject) => {
        const cancel = cancellableTimeout(deps.budgetMs ?? EXTERNAL_TOOL_BUDGET_MS, () => resolve(slowResult(name)));

        running.then(
            (result) => {
                cancel();
                resolve(result);
            },
            (error: unknown) => {
                cancel();
                reject(error);
            }
        );
    });
}

/*
 * The external `/mcp`: Streamable HTTP in stateless mode, one server per request. The credential is already judged; it
 * decides which tools exist for this request, and a revoke counts from the next one.
 */
export async function handleExternalMcpRequest(request: Request, caller: ExternalCaller, deps: ExternalMcpDeps): Promise<Response> {
    const server = new Server({ name: 'ruimte', version: VERSION }, { capabilities: { tools: {} }, instructions: EXTERNAL_INSTRUCTIONS });
    const tools = (): Tool[] => visibleExternalTools(caller, deps.host, deps.tools, deps.extraTools);

    server.setRequestHandler('tools/list', async () => ({
        tools: tools().map((tool) => ({ name: tool.name, description: tool.description, inputSchema: tool.inputSchema, annotations: tool.annotations }))
    }));
    server.setRequestHandler('tools/call', async (call) => callExternalTool(tools(), caller, call.params.name, call.params.arguments ?? {}, deps));

    const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
    await server.connect(transport);

    return transport.handleRequest(request);
}
