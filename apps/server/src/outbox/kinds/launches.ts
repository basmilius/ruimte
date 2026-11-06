import { z } from 'zod';
import { defineOutboxKind } from '../kind.ts';

const RunAfterSettleSchema = z.object({
    kind: z.literal('run-after-settle'),
    // The target is the chat that settled in `worktree`; `launchId` is the task its project ran after it then.
    payload: z.object({ turnId: z.string().min(1), launchId: z.string().min(1), worktree: z.string().min(1) })
});

export const runAfterSettleKind = defineOutboxKind(RunAfterSettleSchema, {
    parked: { chat: 'target', text: (_entry, _title, reason) => `The machine could not run the launch task that follows this chat's turn: ${reason}` }
});
