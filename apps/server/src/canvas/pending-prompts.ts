import { join } from 'node:path';
import { PendingPromptStore as SharedPendingPromptStore, type FirstPrompt as SharedFirstPrompt } from '@adecore/agents/coordination';
import { RoutinePickedSchema } from '@ruimte/contracts';
import { z } from 'zod';

const FirstPromptExtraSchema = z.object({
    // Ruimte's own instructions for the first turn, which a chat hears beside the prompt and folds away in its thread.
    brief: z.string().min(1).optional(),
    // What a person picked in the prompt, sent with it as `chat.send` would: a routine's `@`, `$` and `#`.
    picked: RoutinePickedSchema.optional()
});

type FirstPromptExtra = z.infer<typeof FirstPromptExtraSchema>;

export type FirstPrompt = SharedFirstPrompt<FirstPromptExtra>;

/*
 * The first prompt of an agent node, held against the node id until its session or chat exists. Not
 * in `project.json`, which two people share and two windows would deliver twice.
 */
export class PendingPromptStore extends SharedPendingPromptStore<FirstPromptExtra> {
    constructor(home: string) {
        super({ dir: join(home, 'prompts'), extra: FirstPromptExtraSchema });
    }

    /* Drops what this project was holding for ids it no longer has: the node was deleted before anyone ran it. */
    pruneLeftNodes(projectId: string, ids: ReadonlySet<string>): Promise<void> {
        return this.prune((entry) => entry.projectId === projectId && !ids.has(entry.nodeId));
    }
}
