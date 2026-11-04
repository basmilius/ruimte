import { ToolRefusal } from '@adecore/agents/context';
import type { ActionHandlers } from '@ruimte/actions';
import { hostService, type ServerActionContext } from './context.ts';

function toolsOf(context: ServerActionContext) {
    return hostService(context, 'extensions', 'no-tools', 'This machine offers no extension tools');
}

export const toolActions: ActionHandlers<ServerActionContext> = {
    'tool.list': async (_input, { context }) => ({
        output: {
            tools: toolsOf(context)
                .agentTools()
                .map((tool) => ({ id: tool.id, description: tool.description, parameters: JSON.stringify(tool.parameters) }))
        }
    }),
    'tool.run': async ({ id, input }, { actor, context }) => {
        let parsed: unknown;

        try {
            parsed = JSON.parse(input);
        } catch {
            throw new ToolRefusal('tool-input', 'The input is not JSON');
        }

        return { output: { text: await toolsOf(context).runAgentTool(id, parsed, { caller: actor.id }) } };
    }
};
