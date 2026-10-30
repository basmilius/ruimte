import { z } from 'zod';
import { GitCommitSchema, GitDiffResultSchema } from './git.ts';

export const GitCompareModeSchema = z.enum(['merge-base', 'tips']);
export type GitCompareMode = z.infer<typeof GitCompareModeSchema>;
const CommitOidSchema = z.string().regex(/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/);
const RefSchema = z
    .string()
    .min(1)
    .max(1024)
    .regex(/^[^\0]+$/);

export const GitComparePageSchema = z.object({
    commits: z.array(GitCommitSchema).max(100),
    next: z.number().int().nonnegative().nullable()
});
export type GitComparePage = z.infer<typeof GitComparePageSchema>;

export const GitComparePayloadSchema = z.object({
    cwd: z.string().min(1),
    from: RefSchema,
    to: RefSchema,
    mode: GitCompareModeSchema.default('merge-base')
});
export const GitCompareResultSchema = z.object({
    cwd: z.string(),
    from: RefSchema,
    to: RefSchema,
    fromCommit: CommitOidSchema,
    toCommit: CommitOidSchema,
    baseCommit: CommitOidSchema,
    mode: GitCompareModeSchema,
    diff: GitDiffResultSchema,
    left: GitComparePageSchema,
    right: GitComparePageSchema
});
export type GitCompareResult = z.infer<typeof GitCompareResultSchema>;

export const GitCompareCommitsPayloadSchema = z.object({
    cwd: z.string().min(1),
    fromCommit: CommitOidSchema,
    toCommit: CommitOidSchema,
    side: z.enum(['left', 'right']),
    skip: z.number().int().min(0).max(1_000_000).default(0),
    limit: z.number().int().min(1).max(100).default(30)
});

export const GitBlobPayloadSchema = z.object({
    cwd: z.string().min(1),
    commit: CommitOidSchema,
    path: z.string().min(1).max(4096)
});
export const GitBlobResultSchema = z.object({
    commit: CommitOidSchema,
    path: z.string(),
    text: z
        .string()
        .max(512 * 1024)
        .optional(),
    omitted: z.enum(['missing', 'binary', 'too-large', 'gitlink', 'not-file']).optional(),
    symlink: z.boolean().optional(),
    language: z.string().optional()
});
export type GitBlobResult = z.infer<typeof GitBlobResultSchema>;
