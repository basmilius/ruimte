import { z } from 'zod';

// What the person typed so far; `~` and a relative path are resolved on the daemon's machine.
export const FsBrowsePayloadSchema = z.object({
    partialPath: z.string().min(1).max(512),
    // The directory a relative path counts from, usually the open project's folder.
    cwd: z.string().optional()
});
export type FsBrowsePayload = z.infer<typeof FsBrowsePayloadSchema>;

export const FsBrowseEntrySchema = z.object({
    name: z.string(),
    fullPath: z.string(),
    // Whether the folder already holds a Ruimte canvas.
    hasCanvas: z.boolean()
});
export type FsBrowseEntry = z.infer<typeof FsBrowseEntrySchema>;

export const FsBrowseResultSchema = z.object({
    // The directory the entries were read from, as an absolute path.
    parentPath: z.string(),
    entries: z.array(FsBrowseEntrySchema)
});
export type FsBrowseResult = z.infer<typeof FsBrowseResultSchema>;

export const FsRevealPayloadSchema = z.object({
    path: z.string().min(1)
});
export type FsRevealPayload = z.infer<typeof FsRevealPayloadSchema>;

export const FS_SEARCH_MAX_RESULTS = 200;

// A fuzzy search over the files under a directory, for `@file` mentions in a chat.
export const FsSearchPayloadSchema = z.object({
    cwd: z.string().min(1),
    query: z.string().max(256),
    limit: z.number().int().positive().max(FS_SEARCH_MAX_RESULTS).optional()
});
export type FsSearchPayload = z.infer<typeof FsSearchPayloadSchema>;

export const FsSearchResultSchema = z.object({
    // Paths relative to `cwd`, best match first.
    files: z.array(z.string()),
    // Whether the walk stopped before seeing every file, so a miss is not proof of absence.
    truncated: z.boolean()
});
export type FsSearchResult = z.infer<typeof FsSearchResultSchema>;
