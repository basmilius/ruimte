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

// A directory longer than this is one nobody scrolls; the rest is a "more" row in the tree.
export const FS_LIST_MAX_ENTRIES = 2000;
// Past three levels a prefill costs more than the expand it saves.
export const FS_LIST_MAX_DEPTH = 3;

export const FsEntryKindSchema = z.enum(['file', 'directory', 'symlink', 'other']);
export type FsEntryKind = z.infer<typeof FsEntryKindSchema>;

export const FsEntrySchema = z.object({
    name: z.string(),
    // Absolute on the daemon's machine, the shape `fs.reveal` takes.
    path: z.string(),
    kind: FsEntryKindSchema,
    // Null for anything that is not a file.
    size: z.number().nullable(),
    mtime: z.number(),
    // A leading dot today; the Windows attribute joins later.
    hidden: z.boolean(),
    // What `git check-ignore` says, plus `.git` itself; false everywhere outside a repository.
    ignored: z.boolean()
});
export type FsEntry = z.infer<typeof FsEntrySchema>;

// One directory, or a few levels of it at once so a first paint needs no second round trip.
export const FsListPayloadSchema = z.object({
    path: z.string().min(1),
    depth: z.number().int().positive().max(FS_LIST_MAX_DEPTH).optional(),
    // Whether entries with a leading dot come along; they stay out by default.
    hidden: z.boolean().optional()
});
export type FsListPayload = z.infer<typeof FsListPayloadSchema>;

export const FsListResultSchema = z.object({
    // The directory that was read, as an absolute path.
    path: z.string(),
    // Directories before files per level, then by name; a deeper level follows its own directory.
    entries: z.array(FsEntrySchema),
    // Whether the cap cut the listing short, so a missing name is not proof of absence.
    truncated: z.boolean()
});
export type FsListResult = z.infer<typeof FsListResultSchema>;

export const FsWatchPayloadSchema = z.object({
    path: z.string().min(1)
});
export type FsWatchPayload = z.infer<typeof FsWatchPayloadSchema>;

// The directories that changed under a watched root, coalesced over a settle window.
export const FsChangedEventSchema = z.object({
    root: z.string(),
    paths: z.array(z.string())
});
export type FsChangedEvent = z.infer<typeof FsChangedEventSchema>;

// A text file past this is one no viewer should hold in a string; the client offers the file itself instead.
export const FS_READ_MAX_TEXT_BYTES = 2 * 1024 * 1024;

export const FsReadPayloadSchema = z.object({
    path: z.string().min(1)
});
export type FsReadPayload = z.infer<typeof FsReadPayloadSchema>;

export const FsReadTextSchema = z.object({
    kind: z.literal('text'),
    text: z.string(),
    encoding: z.literal('utf-8'),
    size: z.number(),
    mtime: z.number(),
    // A highlighter id guessed from the extension; a name nothing recognizes leaves it off.
    language: z.string().optional()
});
export type FsReadText = z.infer<typeof FsReadTextSchema>;

// The bytes stay on the daemon: an image is fetched from `GET /fs/file`, anything else is not drawn at all.
export const FsReadBinarySchema = z.object({
    kind: z.literal('binary'),
    mime: z.string(),
    size: z.number(),
    mtime: z.number()
});
export type FsReadBinary = z.infer<typeof FsReadBinarySchema>;

export const FsReadTooLargeSchema = z.object({
    kind: z.literal('too-large'),
    size: z.number()
});
export type FsReadTooLarge = z.infer<typeof FsReadTooLargeSchema>;

export const FsReadResultSchema = z.discriminatedUnion('kind', [FsReadTextSchema, FsReadBinarySchema, FsReadTooLargeSchema]);
export type FsReadResult = z.infer<typeof FsReadResultSchema>;

// What `GET /fs/file` serves; a read result names one of these before the client asks for the bytes.
export const FS_IMAGE_MIMES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/svg+xml'] as const;

export const isImageMime = (mime: string): boolean => (FS_IMAGE_MIMES as readonly string[]).includes(mime);

// Video `GET /fs/file` serves as well, in ranges so a player can seek. Whether the runtime can play
// what is in the container is its own answer (`canPlayType`), which the viewer asks before it draws
// a player: a MOV full of HEVC and most Matroska are containers Chromium recognizes and cannot play.
export const FS_VIDEO_MIMES = ['video/mp4', 'video/webm', 'video/quicktime', 'video/x-matroska', 'video/ogg'] as const;

export const isVideoMime = (mime: string): boolean => (FS_VIDEO_MIMES as readonly string[]).includes(mime);
