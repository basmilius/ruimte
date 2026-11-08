import { toolInputSchema, type ToolInputSchema } from '@adecore/agents/context';
import { runTool, type Audience, type Tool as KitTool, type Toolkit, type ToolCaller, type ToolOutcome } from '../tools/tool.ts';
import { TOOLKITS } from '../tools/toolkits.ts';
import { guideTool } from './guide.ts';

export type { Audience, ToolOutcome } from '../tools/tool.ts';

export type ToolContext = ToolCaller;

export type InputSchema = ToolInputSchema;

export type ToolAnnotations = {
    readOnlyHint?: boolean;
    destructiveHint?: boolean;
};

export interface Tool {
    name: string;
    description: string;
    inputSchema: InputSchema;
    annotations: ToolAnnotations;
    audience: Audience;
    run(input: Readonly<Record<string, unknown>>, context: ToolContext): Promise<ToolOutcome>;
}

/* A tool of a toolkit as the catalog lists it: its schema read off its zod input, and its JSON input run as it came. */
export function listed(tool: KitTool): Tool {
    return {
        name: tool.name,
        description: tool.description,
        inputSchema: toolInputSchema(tool.input),
        annotations: tool.annotations.readOnly === true ? { readOnlyHint: true } : { destructiveHint: tool.annotations.destructive === true },
        audience: tool.audience,
        run: (input, context) => runTool(tool, input, context)
    };
}

/* Every tool of the toolkits, and `guide` over their guide topics. Throws when two tools would share a name. */
export function buildCatalog(toolkits: readonly Toolkit[] = TOOLKITS): Tool[] {
    const all = [guideTool(toolkits), ...toolkits.flatMap((toolkit) => toolkit.tools)].map(listed);
    const seen = new Set<string>();

    for (const tool of all) {
        if (seen.has(tool.name)) {
            throw new Error(`Two tools are named ${tool.name}`);
        }

        seen.add(tool.name);
    }

    return all;
}

let built: readonly Tool[] | null = null;

/* The catalog this daemon serves, built once. */
export function catalog(): readonly Tool[] {
    built ??= buildCatalog();

    return built;
}
