import { z } from 'zod';
import { AgentKindSchema } from './agent.ts';

// Options a model exposes (effort, context window, thinking). Generic descriptors instead of
// per-provider enums: a new model is a catalog entry, not a code change.
export const ModelOptionChoiceSchema = z.object({
    id: z.string().min(1),
    label: z.string(),
    description: z.string().optional()
});
export type ModelOptionChoice = z.infer<typeof ModelOptionChoiceSchema>;

export const ModelOptionDescriptorSchema = z.discriminatedUnion('type', [
    z.object({
        id: z.string().min(1),
        label: z.string(),
        type: z.literal('select'),
        choices: z.array(ModelOptionChoiceSchema).min(1),
        defaultChoice: z.string()
    }),
    z.object({
        id: z.string().min(1),
        label: z.string(),
        type: z.literal('boolean'),
        defaultValue: z.boolean()
    })
]);
export type ModelOptionDescriptor = z.infer<typeof ModelOptionDescriptorSchema>;

export const ModelInfoSchema = z.object({
    slug: z.string().min(1),
    name: z.string(),
    badge: z.string().optional(),
    legacy: z.boolean(),
    isDefault: z.boolean(),
    options: z.array(ModelOptionDescriptorSchema)
});
export type ModelInfo = z.infer<typeof ModelInfoSchema>;

export const ModelSelectionSchema = z.object({
    model: z.string().min(1),
    options: z.record(z.string(), z.union([z.string(), z.boolean()]))
});
export type ModelSelection = z.infer<typeof ModelSelectionSchema>;

// The thread's permission policy, one vocabulary for every provider; each adapter maps it.
export const RuntimeModeSchema = z.enum(['supervised', 'auto-accept-edits', 'auto', 'full-access']);
export type RuntimeMode = z.infer<typeof RuntimeModeSchema>;

// How the agent approaches the task, separate from what it may touch.
export const InteractionModeSchema = z.enum(['default', 'plan']);
export type InteractionMode = z.infer<typeof InteractionModeSchema>;

export const ProviderInfoSchema = z.object({
    kind: AgentKindSchema,
    name: z.string(),
    installed: z.boolean(),
    version: z.string().nullable(),
    // Empty while the CLI is not installed or has no chat backend yet.
    models: z.array(ModelInfoSchema),
    defaultModel: z.string().nullable()
});
export type ProviderInfo = z.infer<typeof ProviderInfoSchema>;

export const ProviderListResultSchema = z.object({
    providers: z.array(ProviderInfoSchema)
});
export type ProviderListResult = z.infer<typeof ProviderListResultSchema>;
