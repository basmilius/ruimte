import { z } from 'zod';
import { AgentKindSchema } from './agent.ts';

/*
 * The model a machine writes short texts with: a chat's title, a commit message, a conflict proposal.
 * The provider stays open on the wire so a newer machine's pick parses everywhere; the daemon holds it
 * to `EDITOR_ASSIST_PROVIDERS` where it runs. A null model is the cheapest one of the provider.
 */
export const TextModelChoiceSchema = z.object({
    provider: AgentKindSchema,
    model: z.string().min(1).max(200).nullable(),
    account: z.string().min(1).max(200).optional()
});
export type TextModelChoice = z.infer<typeof TextModelChoiceSchema>;
