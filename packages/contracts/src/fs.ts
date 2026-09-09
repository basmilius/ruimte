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
