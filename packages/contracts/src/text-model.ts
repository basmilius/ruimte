import { z } from 'zod';
import { AgentKindSchema } from './agent.ts';

/* The writers with a short-text adapter on the daemon; an installed chat provider alone is not one. */
export const TEXT_MODEL_PROVIDERS = ['claude', 'codex', 'grok', 'copilot', 'antigravity', 'apple'] as const;

export const TextModelChoiceSchema = z.object({
    provider: AgentKindSchema,
    model: z.string().min(1).max(200).nullable(),
    account: z.string().min(1).max(200).optional()
});
export type TextModelChoice = z.infer<typeof TextModelChoiceSchema>;

export const TextModelModelsPayloadSchema = TextModelChoiceSchema.omit({ model: true });
export const TextModelModelsResultSchema = z.object({
    models: z.array(z.object({ slug: z.string(), name: z.string() }))
});
