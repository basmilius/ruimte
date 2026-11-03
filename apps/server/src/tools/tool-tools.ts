import { z } from 'zod';
import { ToolRefusal } from '@adecore/agents/context';
import { defineActionTool, runAction } from './action-tool.ts';
import { defineToolkit } from './tool.ts';

const NEEDS_TOOL = 'tool_run needs argument1, the id tool_list prints';

const toolList = defineActionTool('tool', {
    name: 'tool_list',
    action: 'tool.list',
    description: 'Lists the tools extensions on this machine offer.',
    annotations: { readOnly: true },
    input: z.object({}),
    async run(_input, call) {
        const { tools } = await runAction(call, 'tool.list', {});

        return tools.map((tool) => `tool\t${tool.id}\t${tool.description}\t${tool.parameters}`);
    }
});

const toolRun = defineActionTool('tool', {
    name: 'tool_run',
    action: 'tool.run',
    description: 'Runs a tool an extension offers.',
    input: z.object({
        // Named as the tool's first argument was; the tool list holds that name.
        argument1: z.string({ error: NEEDS_TOOL }).min(1, NEEDS_TOOL).optional().describe('The tool, from tool_list'),
        input: z.string({ error: 'input is JSON that fits the schema tool_list prints, as text' }).optional().describe('JSON')
    }),
    async run(input, call) {
        if (input.argument1 === undefined) {
            throw new ToolRefusal('bad-arguments', NEEDS_TOOL);
        }

        const { text } = await runAction(call, 'tool.run', { id: input.argument1, input: input.input ?? '{}' });

        return text.split('\n');
    }
});

export const toolToolkit = defineToolkit('tool', [toolList, toolRun]);
