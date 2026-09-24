import { z } from 'zod';

/*
 * Whether agents on this machine may operate its apps, and what stands in the way. Off by default:
 * a person turns it on per machine, and nothing launches the helper app until then.
 */
export const ComputerUseStatusSchema = z.object({
    enabled: z.boolean(),
    // Whether this machine has the helper app at all: only a macOS daemon that ships beside it or runs from a checkout that built it.
    present: z.boolean(),
    running: z.boolean(),
    // What the helper reported the last time it was asked; null until a running helper answered.
    accessibility: z.boolean().nullable(),
    screenRecording: z.boolean().nullable(),
    // Why the helper could not be asked, in words; absent when nothing went wrong.
    problem: z.string().optional()
});
export type ComputerUseStatus = z.infer<typeof ComputerUseStatusSchema>;

export const ComputerUseSetEnabledPayloadSchema = z.object({
    enabled: z.boolean(),
    // The interface language of the client that turned it on, which the helper's pill then speaks.
    language: z.string().min(2).max(16).optional()
});
export type ComputerUseSetEnabledPayload = z.infer<typeof ComputerUseSetEnabledPayloadSchema>;

/*
 * An agent wants to operate an app it has not been let into. One card per agent and app, whatever
 * it asked first; the answer covers everything that agent does in that app.
 */
export const ComputerApprovalSchema = z.object({
    requestId: z.string().min(1),
    // The chat or terminal the agent runs in, by the id of its node or view.
    nodeId: z.string().min(1),
    surface: z.enum(['chat', 'terminal']),
    nodeTitle: z.string().nullable(),
    projectId: z.string().nullable(),
    projectName: z.string().nullable(),
    app: z.object({ name: z.string(), bundleId: z.string().min(1) }),
    // The verb the agent ran first, such as `state` or `click`.
    command: z.string().min(1),
    createdAt: z.number(),
    // When the card goes if nobody answers; every call of the agent in that app moves it on.
    expiresAt: z.number()
});
export type ComputerApproval = z.infer<typeof ComputerApprovalSchema>;

// Every card of the machine at once, so a client that arrives late and one that missed a settle agree.
export const ComputerApprovalsSchema = z.object({
    approvals: z.array(ComputerApprovalSchema)
});
export type ComputerApprovals = z.infer<typeof ComputerApprovalsSchema>;

/* `once` holds while that chat or terminal session runs; `always` holds on this machine until a person takes it back. */
export const ComputerApprovalChoiceSchema = z.enum(['once', 'always', 'deny']);
export type ComputerApprovalChoice = z.infer<typeof ComputerApprovalChoiceSchema>;

export const ComputerAnswerPayloadSchema = z.object({
    requestId: z.string().min(1),
    choice: ComputerApprovalChoiceSchema
});
export type ComputerAnswerPayload = z.infer<typeof ComputerAnswerPayloadSchema>;

// False when the card was gone already: another client was first, or it expired.
export const ComputerAnswerResultSchema = z.object({
    accepted: z.boolean()
});
export type ComputerAnswerResult = z.infer<typeof ComputerAnswerResultSchema>;
