import type { ChatInfo } from '@adecore/agent-contracts';
import { z } from 'zod';
import { ProjectSummarySchema } from './project.ts';
import { isAbsolutePath } from './stored-path.ts';

export const ChatMoveRefusalReasonSchema = z.enum(['not-in-chats', 'working', 'agents', 'tasks', 'owed', 'messages', 'pr-watch']);

export const ChatMoveTargetSchema = z.union([
    z.object({ projectId: z.string().min(1) }),
    z.object({
        // Absolute on the machine, since the machine is the only one that can resolve anything else.
        folder: z.string().min(1).refine(isAbsolutePath, 'must be an absolute path'),
        name: z.string().min(1),
        createFolder: z.boolean(),
        initGit: z.boolean()
    })
]);
export type ChatMoveTarget = z.infer<typeof ChatMoveTargetSchema>;

export const ChatMoveRefusalSchema = z.object({
    reason: ChatMoveRefusalReasonSchema,
    // Epoch ms; only on `owed` for a `resume-limit`, the moment the chat goes on by itself.
    at: z.number().optional()
});
export type ChatMoveRefusal = z.infer<typeof ChatMoveRefusalSchema>;

export const ChatMoveInfoPayloadSchema = z.object({
    chatId: z.string().min(1),
    // Only to check the names of the chat's own files against that folder.
    to: ChatMoveTargetSchema.optional()
});
export type ChatMoveInfoPayload = z.infer<typeof ChatMoveInfoPayloadSchema>;

export const ChatMoveWorkedFolderSchema = z.object({
    path: z.string().min(1),
    project: z.object({ projectId: z.string().min(1), name: z.string() }).nullable(),
    branch: z.string().nullable(),
    files: z.number().int().nonnegative()
});

export const ChatMoveInfoResultSchema = z.object({
    // At most 5, most used first.
    folders: z.array(ChatMoveWorkedFolderSchema),
    ownFiles: z.object({
        folder: z.string(),
        count: z.number().int().nonnegative(),
        // At most 5.
        names: z.array(z.string())
    }),
    // Own-file names already at `to`, at most 5; empty without `to`.
    conflicts: z.array(z.string()),
    // Other chats in Chats linked to this one with @, in either direction.
    references: z.number().int().nonnegative(),
    // Where a new folder goes by default.
    newFolderParent: z.string(),
    refusal: ChatMoveRefusalSchema.nullable()
});
export type ChatMoveInfoResult = z.infer<typeof ChatMoveInfoResultSchema>;

export const ChatMovePayloadSchema = z.object({
    chatId: z.string().min(1),
    to: ChatMoveTargetSchema,
    ownFiles: z.enum(['move', 'leave'])
});
export type ChatMovePayload = z.infer<typeof ChatMovePayloadSchema>;

export const ChatMoveResultSchema = z.object({
    summary: ProjectSummarySchema,
    viewId: z.string().min(1),
    // The folder the own files stayed in; null when they moved or there were none.
    ownFilesLeftAt: z.string().nullable()
});
export type ChatMoveResult = z.infer<typeof ChatMoveResultSchema>;

export const PROJECT_PROPOSAL_LIMITS = { name: 120, folder: 1024, reason: 600 } as const;

/* An agent in Chats suggesting that its chat become a project, as the card in that chat shows it. The suggestion makes nothing. */
export const ProjectProposalSchema = z.object({
    proposalId: z.string().min(1),
    // The chat that suggests, by the id of its view.
    chatId: z.string().min(1),
    name: z.string().min(1),
    // Absolute on the machine; absent when the agent leaves the folder to the person.
    folder: z.string().min(1).optional(),
    reason: z.string(),
    createdAt: z.number(),
    // When the card goes if nobody answers; every call of the agent for the same chat moves it on.
    expiresAt: z.number()
});
export type ProjectProposal = z.infer<typeof ProjectProposalSchema>;

// Every card of the machine at once, so a client that arrives late and one that missed a settle agree.
export const ProjectProposalsSchema = z.object({
    proposals: z.array(ProjectProposalSchema)
});
export type ProjectProposals = z.infer<typeof ProjectProposalsSchema>;

export const ProjectProposalDeclinePayloadSchema = z.object({
    proposalId: z.string().min(1)
});

// False when the card was gone already: another client was first, the chat moved or it expired.
export const ProjectProposalDeclineResultSchema = z.object({
    accepted: z.boolean()
});

/*
 * Whether a chat does anything a move would cut off: a turn, a question or approval waiting on a
 * person, a subagent or command in the background, a goal, or a message in the queue. The status
 * alone reads idle between turns while some of these still run. With `ownCard`, the card of the
 * chat's own project suggestion holds a chat with no turn at `needs-you`, which a move it asks for
 * does not count as work.
 */
export function chatIsWorking(
    info: (Pick<ChatInfo, 'status' | 'delegating' | 'background' | 'goal' | 'requests' | 'queue'> & Partial<Pick<ChatInfo, 'activeTurnId'>>) | null | undefined,
    ownCard = false
): boolean {
    if (info === null || info === undefined) {
        return false;
    }
    const heldByCard = ownCard && info.status === 'needs-you' && (info.activeTurnId ?? null) === null;
    return (
        info.status === 'running' ||
        (info.status === 'needs-you' && !heldByCard) ||
        info.delegating === true ||
        (info.background?.length ?? 0) > 0 ||
        info.goal?.status === 'active' ||
        (info.requests?.length ?? 0) > 0 ||
        (info.queue?.length ?? 0) > 0
    );
}
