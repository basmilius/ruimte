import { z } from 'zod';
import { AgentKindSchema } from './agent.ts';
import { ChatIdSchema } from './chat.ts';

export const PROVENANCE_LIMITS = {
    promptExcerpt: 400,
    // What a run keeps of the lines it replaced, for a review to put back.
    beforeLines: 200,
    beforeBytes: 16 * 1024
} as const;

export const ProvenanceReviewStateSchema = z.enum(['pending', 'kept', 'undone']);
export type ProvenanceReviewState = z.infer<typeof ProvenanceReviewStateSchema>;

// `tool` is a write the CLI reported; `checkpoint` is a change only the turn's tree shows (a shell command, a formatter), so the author is a likelier guess than a fact.
export const ProvenanceViaSchema = z.enum(['tool', 'checkpoint']);
export type ProvenanceVia = z.infer<typeof ProvenanceViaSchema>;

/*
 * The lines one turn of a chat wrote in a file, as the daemon records them. A run that a later edit cut
 * in two comes back as two entries with the same `id`, so a review of that id covers both pieces.
 */
export const ProvenanceRunSchema = z.object({
    id: z.string().min(1),
    chatId: ChatIdSchema,
    turnId: z.string().min(1),
    // The turn's place in its chat, from 1; absent when the daemon could not count it.
    turn: z.number().int().positive().optional(),
    provider: AgentKindSchema.optional(),
    // Epoch milliseconds.
    at: z.number(),
    promptExcerpt: z.string().max(PROVENANCE_LIMITS.promptExcerpt),
    // One-based and inclusive, in the text of the file the answer is for. A run that only removed lines has `end` one below `start`.
    start: z.number().int().positive(),
    end: z.number().int().nonnegative(),
    // The lines this run replaced or removed, bounded; absent when the daemon did not have them.
    before: z.array(z.string()).optional(),
    review: ProvenanceReviewStateSchema,
    via: ProvenanceViaSchema
});
export type ProvenanceRun = z.infer<typeof ProvenanceRunSchema>;

export const ProvenanceReadPayloadSchema = z.object({
    projectId: z.string().min(1),
    // Absolute on the machine, as every file request is.
    path: z.string().min(1)
});
export type ProvenanceReadPayload = z.infer<typeof ProvenanceReadPayloadSchema>;

export const ProvenanceReadResultSchema = z.object({
    // The file the runs are mapped onto, so a client holding another version asks again.
    mtime: z.number(),
    lines: z.number().int().nonnegative(),
    runs: z.array(ProvenanceRunSchema)
});
export type ProvenanceReadResult = z.infer<typeof ProvenanceReadResultSchema>;

export const ProvenanceReviewPayloadSchema = z.object({
    projectId: z.string().min(1),
    path: z.string().min(1),
    runIds: z.array(z.string().min(1)).min(1),
    state: ProvenanceReviewStateSchema
});
export type ProvenanceReviewPayload = z.infer<typeof ProvenanceReviewPayloadSchema>;

export const ProvenanceReviewResultSchema = z.object({
    // How many runs took the state.
    updated: z.number().int().nonnegative()
});
export type ProvenanceReviewResult = z.infer<typeof ProvenanceReviewResultSchema>;

// To every client that holds the project. `live` is set while the turn still runs.
export const ProvenanceChangedEventSchema = z.object({
    projectId: z.string().min(1),
    path: z.string().min(1),
    chatId: ChatIdSchema,
    turnId: z.string().min(1),
    live: z.boolean()
});
export type ProvenanceChangedEvent = z.infer<typeof ProvenanceChangedEventSchema>;
