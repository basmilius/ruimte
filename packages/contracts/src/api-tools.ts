import { z } from 'zod';

const toolPath = z.string().min(1).max(1024);

function toolCall<Name extends string, Shape extends z.ZodRawShape>(name: Name, fields: Shape) {
    return z.object({ type: z.literal('tool.call'), id: z.string(), name: z.literal(name), ...fields });
}

export const ApiToolCallSchema = z.discriminatedUnion('name', [
    toolCall('list_files', { path: toolPath }),
    toolCall('read_file', { path: toolPath, offset: z.number().int().min(0).max(100_000), limit: z.number().int().min(1).max(100).optional() }),
    toolCall('search_files', { path: toolPath, query: z.string().min(1).max(500), glob: z.string().max(200).optional() }),
    toolCall('edit_file', { path: toolPath, oldText: z.string().min(1).max(12000), newText: z.string().max(12000) }),
    toolCall('write_file', { path: toolPath, content: z.string().max(12000) }),
    toolCall('run_command', { command: z.string().min(1).max(4000) }),
    toolCall('web_search', { query: z.string().min(1).max(500) }),
    toolCall('fetch_page', { url: z.string().url().max(4000) }),
    toolCall('mcp_list_tools', { server: z.string().min(1).max(120).optional(), tool: z.string().min(1).max(200).optional() }),
    toolCall('mcp_call', { server: z.string().min(1).max(120), tool: z.string().min(1).max(200), arguments: z.string().max(12000) }),
    toolCall('ask_user', { question: z.string().min(1).max(1000), options: z.array(z.string().min(1).max(200)).max(6).optional() })
]);
export type ApiToolCall = z.infer<typeof ApiToolCallSchema>;
