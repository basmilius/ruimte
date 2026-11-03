import { describe, expect, test } from 'bun:test';
import type { BackendEvent, BackendLaunch } from '@adecore/agents/chat';
import { ApiTools } from './api-chat.ts';
import { MCP_REQUEST_TIMEOUT_S } from '../providers/ruimte-mcp.ts';
import { RUIMTE_MCP_LIMITS, type ApiMcpLimits, type ApiMcpServer, type ConnectApiMcp } from './api-mcp.ts';
import { NANOGPT_TOOLS } from './nanogpt-tools.ts';

const ENV = { RUIMTE_MCP_URL: 'http://127.0.0.1:4210/mcp', RUIMTE_CONTEXT_TOKEN: 'tok' };

function harness(env: Record<string, string>, connectMcp: ConnectApiMcp) {
    const events: BackendEvent[] = [];
    const launch: BackendLaunch = {
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
    };
    const tools = new ApiTools({
        launch,
        host: { onEvent: (event) => events.push(event) },
        mode: 'supervised',
        approval: 'NanoGPT requests access to this project.',
        home: '/home',
        executeTool: () => Promise.reject(new Error('A project tool ran.')),
        connectMcp
    });

    return { tools, events };
}

describe('ApiTools', () => {
    test("offers Ruimte's tools beside the project tools and runs one without a card, with the chat's token", async () => {
        const servers: ApiMcpServer[] = [];
        const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
        let closed = false;
        const { tools, events } = harness(ENV, async (server) => {
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

        const definitions = await tools.definitions();
        expect(definitions.map((tool) => tool.name)).toEqual([...NANOGPT_TOOLS.map((tool) => tool.function.name), 'mcp__ruimte__node_list']);
        expect(await tools.definitions()).toEqual(definitions);
        expect(servers).toEqual([{ type: 'http', url: ENV.RUIMTE_MCP_URL, headers: { Authorization: 'Bearer ${RUIMTE_CONTEXT_TOKEN}' } }]);

        expect(await tools.run('mcp__ruimte__node_list', '{}', new AbortController().signal)).toEqual({ output: 'node\tn1\tNote', failed: false });
        expect(calls).toEqual([{ name: 'node_list', args: {} }]);
        expect(events.map((event) => event.type)).toEqual(['tool.started', 'tool.done']);

        expect((await tools.run('mcp__ruimte__node_delete', '{}', new AbortController().signal)).failed).toBe(true);
        await tools.close();
        expect(closed).toBe(true);
    });

    test("Ruimte's tools get the time and answer size the daemon's route allows", async () => {
        const given: Array<ApiMcpLimits | undefined> = [];
        const { tools } = harness(ENV, async (_server, _cwd, _env, _signal, limits) => {
            given.push(limits);
            return { list: async () => [], call: async () => ({ content: [] }), close: async () => {} };
        });

        await tools.definitions();
        await tools.close();
        expect(given).toEqual([RUIMTE_MCP_LIMITS]);
        expect(RUIMTE_MCP_LIMITS.callTimeoutMs).toBe(MCP_REQUEST_TIMEOUT_S * 1000);
    });

    test('a chat the daemon gave no token, or one that cannot reach the server, keeps the project tools alone', async () => {
        const unused = harness({}, () => Promise.reject(new Error('Connected without a token.')));
        expect(await unused.tools.definitions()).toHaveLength(NANOGPT_TOOLS.length);

        const refused = harness(ENV, () => Promise.reject(new Error('401')));
        expect(await refused.tools.definitions()).toHaveLength(NANOGPT_TOOLS.length);
        expect(refused.events).toEqual([{ type: 'note', level: 'warning', text: "Ruimte's tools are unavailable in this chat: 401" }]);
    });
});
