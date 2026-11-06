import { describe, expect, test } from 'bun:test';
import type { BackendEvent, BackendLaunch } from '@adecore/agents/chat';
import { MCP_REQUEST_TIMEOUT_S, withRuimteMcp } from '../ruimte-mcp.ts';
import { RUIMTE_MCP_LIMITS, type ApiMcpLimits, type ApiMcpServer, type ConnectApiMcp } from './api-mcp.ts';
import { ruimteApiTools } from './ruimte-api-tools.ts';

const ENV = { RUIMTE_MCP_URL: 'http://127.0.0.1:4210/mcp', RUIMTE_CONTEXT_TOKEN: 'tok' };

function harness(env: Record<string, string>, connectMcp: ConnectApiMcp) {
    const events: BackendEvent[] = [];

    // The session applies the provider's launch additions before it makes a backend, which is how the server gets on the launch.
    const launch: BackendLaunch = withRuimteMcp({
        command: ['nanogpt'],
        cwd: '/work',
        env,
        selection: { model: 'tool-model', options: {} },
        modelName: 'Tool model',
        runtimeMode: 'supervised',
        resume: null,
        generation: 1,
        instructions: null,
        resumeNote: null
    });

    return { tools: ruimteApiTools(launch, { onEvent: (event) => events.push(event) }, connectMcp), events };
}

describe("Ruimte's tools in a chat on a plain API", () => {
    test("are the tools of Ruimte's server under Claude Code's names, reached with the chat's token", async () => {
        const servers: ApiMcpServer[] = [];
        const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
        let closed = false;

        const { tools } = harness(ENV, async (server) => {
            servers.push(server);

            return {
                list: async () => [{ name: 'node_list', description: 'Lists nodes.', inputSchema: { type: 'object', properties: {} } }],
                call: async (name, args) => {
                    calls.push({ name, args });

                    return { content: [{ type: 'text', text: 'node\tn1\tNote' }] };
                },
                close: async () => {
                    closed = true;
                }
            };
        });

        const definitions = await tools!.definitions();
        expect(definitions.map((tool) => tool.name)).toEqual(['mcp__ruimte__node_list']);
        expect(await tools!.definitions()).toEqual(definitions);
        expect(servers).toEqual([{ type: 'http', url: ENV.RUIMTE_MCP_URL, headers: { Authorization: 'Bearer ${RUIMTE_CONTEXT_TOKEN}' } }]);

        expect(await tools!.run('mcp__ruimte__node_list', {}, new AbortController().signal)).toEqual({ output: 'node\tn1\tNote', failed: false });
        expect(calls).toEqual([{ name: 'node_list', args: {} }]);

        expect((await tools!.run('mcp__ruimte__node_delete', {}, new AbortController().signal)).failed).toBe(true);
        await tools!.close();
        expect(closed).toBe(true);
    });

    test("get the time and answer size the daemon's route allows", async () => {
        const given: Array<ApiMcpLimits | undefined> = [];

        const { tools } = harness(ENV, async (_server, _env, _signal, limits) => {
            given.push(limits);

            return { list: async () => [], call: async () => ({ content: [] }), close: async () => {} };
        });

        await tools!.definitions();
        await tools!.close();

        expect(given).toEqual([RUIMTE_MCP_LIMITS]);
        expect(RUIMTE_MCP_LIMITS.callTimeoutMs).toBe(MCP_REQUEST_TIMEOUT_S * 1000);
    });

    test('are none for a chat the daemon gave no token, or one that cannot reach the server', async () => {
        expect(harness({}, () => Promise.reject(new Error('Connected without a token.'))).tools).toBeNull();

        const refused = harness(ENV, () => Promise.reject(new Error('401')));
        expect(await refused.tools!.definitions()).toEqual([]);
        expect(refused.events).toEqual([{ type: 'note', level: 'warning', text: "Ruimte's tools are unavailable in this chat: 401" }]);
    });
});
