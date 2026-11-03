import { describe, expect, test } from 'bun:test';
import { toolAnswer, toolCall } from './tool-test-helpers.ts';
import type { CanvasHost } from './host.ts';

interface AgentTool {
    id: string;
    description: string;
    parameters: unknown;
}

function hostWith(tools: AgentTool[], runs: Array<{ id: string; input: unknown }> = []): CanvasHost {
    return {
        projects: { locate: () => ({ projectId: 'p1', folder: '/tmp/p1', canvasId: 'main' }) },
        extensions: {
            agentTools: () => tools,
            runAgentTool: async (id: string, input: unknown) => {
                runs.push({ id, input });

                return `ran ${id}`;
            }
        }
    } as unknown as CanvasHost;
}

describe('extension tools', () => {
    test('tool_list says there are none and what makes one appear', async () => {
        const { lines } = await toolAnswer('tool_list', {}, toolCall('chat-1', hostWith([])));

        expect(lines).toHaveLength(1);
        expect(lines[0]).toStartWith('note\tNo extension on this machine offers a tool');
        expect(lines[0]).toContain('defineAgentTool');
    });

    test('tool_run takes the tool by the id tool_list prints', async () => {
        const runs: Array<{ id: string; input: unknown }> = [];
        const call = toolCall('chat-1', hostWith([{ id: 'acme.tickets/tickets', description: 'Open tickets', parameters: { type: 'object' } }], runs));

        expect((await toolAnswer('tool_list', {}, call)).lines).toEqual(['tool\tacme.tickets/tickets\tOpen tickets\t{"type":"object"}']);
        expect((await toolAnswer('tool_run', { id: 'acme.tickets/tickets', input: '{"state":"open"}' }, call)).lines).toEqual(['ran acme.tickets/tickets']);
        expect((await toolAnswer('tool_run', {}, call)).lines).toEqual(['refused\tbad-arguments\ttool_run needs id, the id tool_list prints']);
        expect(runs).toEqual([{ id: 'acme.tickets/tickets', input: { state: 'open' } }]);
    });
});
