import { z } from 'zod';

export const AppleFoundationRequestSchema = z.discriminatedUnion('type', [
    z.object({ type: z.literal('probe') }),
    z.object({ type: z.literal('turn'), id: z.string(), prompt: z.string() }),
    z.object({ type: z.literal('cancel'), id: z.string() }),
    z.object({ type: z.literal('compact'), id: z.string() }),
    z.object({ type: z.literal('tool.result'), id: z.string(), output: z.string(), outcome: z.enum(['success', 'error', 'denied', 'recoverable_error']) })
]);
export type AppleFoundationRequest = z.infer<typeof AppleFoundationRequestSchema>;

export const AppleFoundationEventSchema = z.discriminatedUnion('type', [
    z.object({ type: z.literal('availability'), available: z.boolean(), reason: z.string().optional() }),
    z.object({
        type: z.literal('session'),
        id: z.string().uuid(),
        restored: z.boolean(),
        protocolVersion: z.number().int().optional(),
        note: z.string().optional(),
        contextSize: z.number().int().positive().optional(),
        baseTokens: z.number().int().nonnegative().optional()
    }),
    z.object({ type: z.literal('startup.error'), text: z.string() }),
    z.object({ type: z.literal('compacted'), id: z.string(), text: z.string() }),
    z.object({ type: z.literal('text.snapshot'), id: z.string(), text: z.string() }),
    z.discriminatedUnion('name', [
        z.object({ type: z.literal('tool.call'), id: z.string(), name: z.literal('list_files'), path: z.string().min(1).max(1024) }),
        z.object({
            type: z.literal('tool.call'),
            id: z.string(),
            name: z.literal('read_file'),
            path: z.string().min(1).max(1024),
            offset: z.number().int().min(0).max(100_000),
            limit: z.number().int().min(1).max(100).optional()
        }),
        z.object({
            type: z.literal('tool.call'),
            id: z.string(),
            name: z.literal('search_files'),
            path: z.string().min(1).max(1024),
            query: z.string().min(1).max(500),
            glob: z.string().max(200).optional()
        }),
        z.object({
            type: z.literal('tool.call'),
            id: z.string(),
            name: z.literal('edit_file'),
            path: z.string().min(1).max(1024),
            oldText: z.string().min(1).max(12000),
            newText: z.string().max(12000)
        }),
        z.object({
            type: z.literal('tool.call'),
            id: z.string(),
            name: z.literal('write_file'),
            path: z.string().min(1).max(1024),
            content: z.string().max(12000)
        }),
        z.object({ type: z.literal('tool.call'), id: z.string(), name: z.literal('run_command'), command: z.string().min(1).max(4000) }),
        z.object({ type: z.literal('tool.call'), id: z.string(), name: z.literal('web_search'), query: z.string().min(1).max(500) }),
        z.object({ type: z.literal('tool.call'), id: z.string(), name: z.literal('fetch_page'), url: z.string().url().max(4000) }),
        z.object({
            type: z.literal('tool.call'),
            id: z.string(),
            name: z.literal('mcp_list_tools'),
            server: z.string().min(1).max(120).optional(),
            tool: z.string().min(1).max(200).optional()
        }),
        z.object({
            type: z.literal('tool.call'),
            id: z.string(),
            name: z.literal('mcp_call'),
            server: z.string().min(1).max(120),
            tool: z.string().min(1).max(200),
            arguments: z.string().max(12000)
        }),
        z.object({
            type: z.literal('tool.call'),
            id: z.string(),
            name: z.literal('ask_user'),
            question: z.string().min(1).max(1000),
            options: z.array(z.string().min(1).max(200)).max(6).optional()
        })
    ]),
    z.object({ type: z.literal('context'), id: z.string(), text: z.string() }),
    z.object({
        type: z.literal('metrics'),
        id: z.string(),
        elapsedMs: z.number().nonnegative(),
        firstTextMs: z.number().nonnegative().optional(),
        toolCalls: z.number().int().nonnegative(),
        contextTokens: z.number().int().nonnegative(),
        schemaTokens: z.number().int().nonnegative()
    }),
    z.object({ type: z.literal('done'), id: z.string(), state: z.enum(['done', 'aborted', 'error']), text: z.string().optional() })
]);
export type AppleFoundationEvent = z.infer<typeof AppleFoundationEventSchema>;
