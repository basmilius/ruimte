import { z } from 'zod';

export const WorktreeSchema = z.object({
    path: z.string(),
    branch: z.string()
});
export type Worktree = z.infer<typeof WorktreeSchema>;

// A worktree for a branch of the repository; made under the app data dir when it does not exist yet.
export const WorktreeAddPayloadSchema = z.object({
    repo: z.string().min(1),
    branch: z.string().min(1)
});
export type WorktreeAddPayload = z.infer<typeof WorktreeAddPayloadSchema>;

export const WorktreeAddResultSchema = z.object({
    worktree: WorktreeSchema,
    // False when the branch already had a worktree and that one was answered.
    created: z.boolean()
});
export type WorktreeAddResult = z.infer<typeof WorktreeAddResultSchema>;

export const WorktreeListPayloadSchema = z.object({
    repo: z.string().min(1)
});
export type WorktreeListPayload = z.infer<typeof WorktreeListPayloadSchema>;

export const WorktreeListResultSchema = z.object({
    worktrees: z.array(WorktreeSchema)
});
export type WorktreeListResult = z.infer<typeof WorktreeListResultSchema>;

export const WorktreeRemovePayloadSchema = z.object({
    repo: z.string().min(1),
    path: z.string().min(1)
});
export type WorktreeRemovePayload = z.infer<typeof WorktreeRemovePayloadSchema>;
