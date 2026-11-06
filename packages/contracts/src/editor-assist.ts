import { EmptySchema } from '@adecore/agent-contracts/protocol';
import { z } from 'zod';

export const EditorAssistProviderSchema = z.enum(['claude', 'codex', 'grok', 'antigravity']);

/* Absent or null chooses the cheapest model of the first available provider in this order. */
export const EDITOR_ASSIST_PROVIDERS = EditorAssistProviderSchema.options;

export const EditorAssistAgentSchema = z.object({
    provider: EditorAssistProviderSchema,
    model: z.string().min(1).max(200).nullable(),
    account: z.string().min(1).max(200).optional()
});
export type EditorAssistAgent = z.infer<typeof EditorAssistAgentSchema>;

export const EditorAssistPurposeSchema = z.enum(['explain', 'names', 'ghost']);
export type EditorAssistPurpose = z.infer<typeof EditorAssistPurposeSchema>;

export const EditorAssistStatusPayloadSchema = z.object({ agent: EditorAssistAgentSchema.nullable().optional() });

export const EditorAssistStatusResultSchema = z.object({
    available: z.boolean(),
    reason: z.string().optional(),
    provider: EditorAssistProviderSchema.optional(),
    model: z.string().optional(),
    modelName: z.string().optional()
});
export type EditorAssistStatusResult = z.infer<typeof EditorAssistStatusResultSchema>;

export const EditorAssistGeneratePayloadSchema = z.object({
    id: z.string().min(1).max(80),
    purpose: EditorAssistPurposeSchema,
    prompt: z.string().min(1).max(12_000),
    agent: EditorAssistAgentSchema.nullable().optional(),
    stream: z.boolean().optional()
});
export type EditorAssistGeneratePayload = z.infer<typeof EditorAssistGeneratePayloadSchema>;

export const EditorAssistGenerateResultSchema = z.object({
    state: z.enum(['done', 'aborted']),
    text: z.string()
});
export type EditorAssistGenerateResult = z.infer<typeof EditorAssistGenerateResultSchema>;

export const EditorAssistCancelPayloadSchema = z.object({ id: z.string().min(1).max(80) });
export const EditorAssistTextEventSchema = z.object({ id: z.string(), text: z.string() });

export const EDITOR_ASSIST_REQUEST_SCHEMAS = {
    'editor.status': { payload: EditorAssistStatusPayloadSchema, result: EditorAssistStatusResultSchema },
    // The text streams to the asking client as `editor.text` while it runs; the result is the whole of it.
    'editor.generate': { payload: EditorAssistGeneratePayloadSchema, result: EditorAssistGenerateResultSchema },
    'editor.cancel': { payload: EditorAssistCancelPayloadSchema, result: EmptySchema }
} as const;

export const EDITOR_ASSIST_EVENT_SCHEMAS = {
    'editor.text': EditorAssistTextEventSchema
} as const;
