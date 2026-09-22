import { z } from 'zod';

// What the person typed so far; `~` and a relative path are resolved on the daemon's machine.
export const FsBrowsePayloadSchema = z.object({
    partialPath: z.string().min(1).max(512),
    // The directory a relative path counts from, usually the open project's folder.
    cwd: z.string().optional(),
    /* Whether folders with a leading dot come along; they stay out by default. Optional, because a
       daemon older than this client would fail the whole parse on a field it does not know. */
    hidden: z.boolean().optional()
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
    entries: z.array(FsBrowseEntrySchema),
    /* Whether `parentPath` is a directory that is there; an empty listing alone cannot tell a
       missing folder from an empty one. Undefined from a daemon that predates the field. */
    exists: z.boolean().optional()
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

// A result list past this is one nobody reads, and the search that fills it is one nobody waits for.
export const FS_GREP_MAX_RESULTS = 200;
// Lines above and below a hit; enough to recognize the code around it, few enough to scan the list.
export const FS_GREP_CONTEXT_LINES = 2;

// A text search through the files under a directory, for the palette's find-in-files mode.
export const FsGrepPayloadSchema = z.object({
    cwd: z.string().min(1),
    query: z.string().min(1).max(512),
    // Whether the query is a regular expression rather than the literal text it reads as.
    regex: z.boolean().optional(),
    caseSensitive: z.boolean().optional(),
    wholeWord: z.boolean().optional(),
    limit: z.number().int().positive().max(FS_GREP_MAX_RESULTS).optional()
});
export type FsGrepPayload = z.infer<typeof FsGrepPayloadSchema>;

export const FsGrepMatchSchema = z.object({
    // Relative to `cwd` with POSIX separators, the shape `fs.search` answers with.
    path: z.string(),
    // One-based, the number a viewer puts in its gutter.
    line: z.number().int().positive(),
    // Where the hit sits in `text`, as an offset and a length in UTF-16 code units.
    column: z.number().int().nonnegative(),
    length: z.number().int().nonnegative(),
    text: z.string(),
    // The lines around the hit, nearest last and nearest first; fewer at the edges of a file.
    before: z.array(z.string()),
    after: z.array(z.string())
});
export type FsGrepMatch = z.infer<typeof FsGrepMatchSchema>;

export const FsGrepResultSchema = z.object({
    // Grouped by file in the order the files were walked, and by line within a file.
    matches: z.array(FsGrepMatchSchema),
    // How many files those matches come from, which the list cannot say once it is cut short.
    files: z.number().int().nonnegative(),
    // Whether the limit stopped the search, so a miss is not proof of absence.
    truncated: z.boolean()
});
export type FsGrepResult = z.infer<typeof FsGrepResultSchema>;

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
    /* Whether this is out of the way until a person asks for everything: what git ignores, build
       output by name, and a leading dot in a folder without a repository. OS rubbish and Ruimte's
       own state are never listed at all, whatever the caller asks. */
    hidden: z.boolean(),
    // What `git check-ignore` says, plus `.git` itself; false everywhere outside a repository.
    ignored: z.boolean()
});
export type FsEntry = z.infer<typeof FsEntrySchema>;

// One directory, or a few levels of it at once so a first paint needs no second round trip.
export const FsListPayloadSchema = z.object({
    path: z.string().min(1),
    depth: z.number().int().positive().max(FS_LIST_MAX_DEPTH).optional(),
    // Whether hidden and ignored entries come along; they stay out by default.
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

// Container recognition does not imply codec support, so the viewer still checks `canPlayType`.
export const FS_VIDEO_MIMES = ['video/mp4', 'video/webm', 'video/quicktime', 'video/x-matroska', 'video/ogg'] as const;

export const isVideoMime = (mime: string): boolean => (FS_VIDEO_MIMES as readonly string[]).includes(mime);
