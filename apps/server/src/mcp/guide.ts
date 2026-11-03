import { ToolRefusal } from '@adecore/agents/context';
import { z } from 'zod';
import { defineTool, type Tool, type Toolkit } from '../tools/tool.ts';

/* `guide`, which prints the format of a text field on demand from the topics the toolkits keep beside their tools, so no schema has to carry it. */
export function guideTool(toolkits: readonly Toolkit[]): Tool {
    const topics = new Map(toolkits.flatMap((toolkit) => toolkit.guides.map((guide) => [guide.name, guide.lines] as const)));
    const names = [...topics.keys()];
    const needs = `guide needs topic, one of ${names.join(', ')}`;

    return defineTool('guide', {
        name: 'guide',
        description: 'Prints the format of an input whose field names a topic.',
        annotations: { readOnly: true },
        input: z.object({ topic: z.enum(names as [string, ...string[]], { error: needs }) }),
        run: async ({ topic }) => {
            const lines = topics.get(topic);

            if (lines === undefined) {
                throw new ToolRefusal('bad-arguments', needs);
            }

            return [...lines];
        }
    });
}
