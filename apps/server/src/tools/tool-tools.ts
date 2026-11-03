import { z } from 'zod';
import { ToolRefusal } from '@adecore/agents/context';
import { defineActionTool, runAction } from './action-tool.ts';
import { defineToolkit } from './tool.ts';

const NEEDS_TOOL = 'tool_run needs id, the id tool_list prints';

const NO_TOOLS =
    'note\tNo extension on this machine offers a tool. One appears once an installed extension with agents.tools in its manifest calls defineAgentTool in its server part';

const toolList = defineActionTool('tool', {
    name: 'tool_list',
    action: 'tool.list',
    description: 'Lists the tools extensions on this machine offer.',
    annotations: { readOnly: true },
    input: z.object({}),
    async run(_input, call) {
        const { tools } = await runAction(call, 'tool.list', {});

        if (tools.length === 0) {
            return [NO_TOOLS];
        }

        return tools.map((tool) => `tool\t${tool.id}\t${tool.description}\t${tool.parameters}`);
    }
});

const toolRun = defineActionTool('tool', {
    name: 'tool_run',
    action: 'tool.run',
    description: 'Runs a tool an extension offers.',
    input: z.object({
        id: z.string({ error: NEEDS_TOOL }).min(1, NEEDS_TOOL).optional().describe('The tool, from tool_list'),
        input: z.string({ error: 'input is JSON that fits the schema tool_list prints, as text' }).optional().describe('JSON')
    }),
    async run(input, call) {
        if (input.id === undefined) {
            throw new ToolRefusal('bad-arguments', NEEDS_TOOL);
        }

        const { text } = await runAction(call, 'tool.run', { id: input.id, input: input.input ?? '{}' });

        return text.split('\n');
    }
});

export const toolToolkit = defineToolkit('tool', [toolList, toolRun]);
