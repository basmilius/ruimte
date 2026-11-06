import { z } from 'zod';
import { ARCHIVE_ENTRY_PATH_MAX } from './bytes.ts';
import { ProjectIdSchema } from './project.ts';

// A listing past this is one nobody scrolls; the rest is left out and the answer says so.
export const ARCHIVE_LIST_MAX_ENTRIES = 10_000;

export const ArchiveFormatSchema = z.enum(['zip', 'tar', 'tar-gzip', 'gzip']);
export type ArchiveFormat = z.infer<typeof ArchiveFormatSchema>;

export const ArchiveEntryKindSchema = z.enum(['file', 'directory', 'symlink']);

export const ArchiveEntrySchema = z.object({
    // Relative, separated by `/`, without a trailing one; never absolute and never with a `..`.
    path: z.string(),
    kind: ArchiveEntryKindSchema,
    // What the archive says it holds; a read still stops where the bytes do.
    size: z.number().int().nonnegative(),
    // Only a zip says this per entry.
    compressedSize: z.number().int().nonnegative().optional(),
    mtime: z.number().optional(),
    // False for an encrypted entry, a method this machine does not inflate, a hard link and a sparse file.
    readable: z.boolean()
});
export type ArchiveEntry = z.infer<typeof ArchiveEntrySchema>;

/* Held to the boundary of `fs.read`. A gzip that holds no tar lists one entry, named after the file it was made from. */
export const ArchiveListPayloadSchema = z.object({
    path: z.string().min(1)
});

export const ArchiveListResultSchema = z.object({
    format: ArchiveFormatSchema,
    // In the order the archive keeps them; the first of two entries with one path is the one listed.
    entries: z.array(ArchiveEntrySchema),
    // `ARCHIVE_LIST_MAX_ENTRIES` or the bytes a compressed tar may unpack to stopped the listing.
    truncated: z.boolean(),
    // Entries left out because their names would land outside the folder they are extracted into.
    unsafe: z.number().int().nonnegative()
});
export type ArchiveListResult = z.infer<typeof ArchiveListResultSchema>;

/*
 * Writes entries into `to`, making the folders that are missing. Held to the boundary of `fs.write`,
 * with `.git` and `.ruimte` closed; a file that is already there is refused as `exists` before anything
 * is written. Links are never made. With a `projectId` the language servers hear that `to` was made.
 */
export const ArchiveExtractPayloadSchema = z.object({
    path: z.string().min(1),
    // A directory takes everything under it. Absent, the whole archive.
    entries: z.array(z.string().min(1).max(ARCHIVE_ENTRY_PATH_MAX)).max(ARCHIVE_LIST_MAX_ENTRIES).optional(),
    // Absolute; an entry lands at its own path inside it.
    to: z.string().min(1),
    projectId: ProjectIdSchema.optional()
});

// At most this many skipped entries are named; `skippedTotal` counts them all.
export const ARCHIVE_SKIPPED_MAX = 100;

export const ArchiveSkippedSchema = z.object({
    path: z.string(),
    // `link`, `unreadable`, `unsafe-name`, `closed` (under `.git` or `.ruimte`) or `duplicate`; a string, so a later reason parses.
    reason: z.string()
});
export type ArchiveSkipped = z.infer<typeof ArchiveSkippedSchema>;

export const ArchiveExtractResultSchema = z.object({
    // Absolute.
    to: z.string(),
    files: z.number().int().nonnegative(),
    directories: z.number().int().nonnegative(),
    bytes: z.number().int().nonnegative(),
    skipped: z.array(ArchiveSkippedSchema),
    skippedTotal: z.number().int().nonnegative()
});
export type ArchiveExtractResult = z.infer<typeof ArchiveExtractResultSchema>;

export const ARCHIVE_REQUEST_SCHEMAS = {
    'archive.list': { payload: ArchiveListPayloadSchema, result: ArchiveListResultSchema },
    // Unpacks into a project; never overwrites and never makes a link.
    'archive.extract': { payload: ArchiveExtractPayloadSchema, result: ArchiveExtractResultSchema }
} as const;
