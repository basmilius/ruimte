import { z } from 'zod';
import { ProjectIdSchema } from './project.ts';

// What the person typed so far; `~` and a relative path are resolved on the daemon's machine.
export const FsBrowsePayloadSchema = z.object({
    partialPath: z.string().min(1).max(512),
    // The directory a relative path counts from, usually the open project's folder.
    cwd: z.string().optional(),
    // Includes folders with a leading dot.
    hidden: z.boolean().optional()
});
export type FsBrowsePayload = z.infer<typeof FsBrowsePayloadSchema>;

export const FsBrowseEntrySchema = z.object({
    name: z.string(),
    fullPath: z.string(),
    hasCanvas: z.boolean()
});
export type FsBrowseEntry = z.infer<typeof FsBrowseEntrySchema>;

export const FsBrowseResultSchema = z.object({
    // Absolute.
    parentPath: z.string(),
    entries: z.array(FsBrowseEntrySchema),
    // An empty listing alone cannot tell a missing folder from an empty one.
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
    // The walk stopped early, so a miss is not proof of absence.
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
    regex: z.boolean().optional(),
    caseSensitive: z.boolean().optional(),
    wholeWord: z.boolean().optional(),
    limit: z.number().int().positive().max(FS_GREP_MAX_RESULTS).optional()
});
export type FsGrepPayload = z.infer<typeof FsGrepPayloadSchema>;

export const FsGrepMatchSchema = z.object({
    // Relative to `cwd` with POSIX separators, the shape `fs.search` answers with.
    path: z.string(),
    // One-based.
    line: z.number().int().positive(),
    // In `text`, in UTF-16 code units.
    column: z.number().int().nonnegative(),
    length: z.number().int().nonnegative(),
    text: z.string(),
    // Nearest last and nearest first; fewer at the edges of a file.
    before: z.array(z.string()),
    after: z.array(z.string())
});
export type FsGrepMatch = z.infer<typeof FsGrepMatchSchema>;

export const FsGrepResultSchema = z.object({
    // Grouped by file in the order the files were walked, and by line within a file.
    matches: z.array(FsGrepMatchSchema),
    // The list cannot say this once it is cut short.
    files: z.number().int().nonnegative(),
    // The limit stopped the search, so a miss is not proof of absence.
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
    size: z.number().nullable(),
    mtime: z.number(),
    // What git ignores, build output by name, and a leading dot outside a repository. OS rubbish and
    // Ruimte's own state are never listed at all.
    hidden: z.boolean(),
    // What `git check-ignore` says, plus `.git` itself; false everywhere outside a repository.
    ignored: z.boolean()
});
export type FsEntry = z.infer<typeof FsEntrySchema>;

// One directory, or a few levels of it at once so a first paint needs no second round trip.
export const FsListPayloadSchema = z.object({
    path: z.string().min(1),
    depth: z.number().int().positive().max(FS_LIST_MAX_DEPTH).optional(),
    hidden: z.boolean().optional()
});
export type FsListPayload = z.infer<typeof FsListPayloadSchema>;

export const FsListResultSchema = z.object({
    // Absolute.
    path: z.string(),
    // Directories before files per level, then by name; a deeper level follows its own directory.
    entries: z.array(FsEntrySchema),
    // A missing name is not proof of absence.
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

// The most text one JSON frame carries. Past it the client fetches the bytes over `GET /fs/file` or `bytes.read`.
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
    size: z.number(),
    // Pins the version the client fetches as bytes; a daemon from before that route leaves it off.
    mtime: z.number().optional()
});
export type FsReadTooLarge = z.infer<typeof FsReadTooLargeSchema>;

export const FsReadResultSchema = z.discriminatedUnion('kind', [FsReadTextSchema, FsReadBinarySchema, FsReadTooLargeSchema]);
export type FsReadResult = z.infer<typeof FsReadResultSchema>;

// Held to `FS_READ_MAX_TEXT_BYTES` in UTF-8; a file whose mtime moved past `expectedMtime` is refused as `stale`.
export const FsWritePayloadSchema = z.object({
    path: z.string().min(1),
    text: z.string(),
    // The `mtime` the read answered with; overwriting a file that moved is a new write at its fresh mtime.
    expectedMtime: z.number()
});
export type FsWritePayload = z.infer<typeof FsWritePayloadSchema>;

export const FsWriteResultSchema = z.object({
    size: z.number(),
    mtime: z.number()
});
export type FsWriteResult = z.infer<typeof FsWriteResultSchema>;

/* Makes missing parent folders. An existing path is refused as `exists`. Held to the boundary of
   `fs.write`, with `.git` and `.ruimte` closed; `text` is held to `FS_READ_MAX_TEXT_BYTES`. */
export const FsCreatePayloadSchema = z.object({
    path: z.string().min(1),
    kind: z.enum(['file', 'directory']),
    text: z.string().optional()
});
export type FsCreatePayload = z.infer<typeof FsCreatePayloadSchema>;

export const FsCreateResultSchema = z.object({
    size: z.number(),
    mtime: z.number()
});
export type FsCreateResult = z.infer<typeof FsCreateResultSchema>;

/* To the machine's trash. Only inside an open project or one of its worktrees, and never the project
   folder itself, `.git` or `.ruimte`. */
export const FsDeletePayloadSchema = z.object({
    path: z.string().min(1)
});
export type FsDeletePayload = z.infer<typeof FsDeletePayloadSchema>;

/*
 * Inside the boundary of `fs.write`, with `.git` and `.ruimte` closed. A taken path is refused as
 * `exists`; missing folders above `to` are made. With a `projectId` the language servers first make the
 * edits the move brings (imports, a namespace) and then hear it moved; a slow or failing server holds nothing up.
 */
export const FsRenamePayloadSchema = z.object({
    path: z.string().min(1),
    to: z.string().min(1),
    projectId: ProjectIdSchema.optional(),
    // False when the caller made those edits itself, as a refactor that moves a file does; the servers then only hear that it moved.
    edits: z.boolean().optional()
});
export type FsRenamePayload = z.infer<typeof FsRenamePayloadSchema>;

export const FsRenameResultSchema = z.object({
    // The files the language servers edited before the move, at the places they had.
    edited: z.array(z.string()).optional()
});
export type FsRenameResult = z.infer<typeof FsRenameResultSchema>;

// What `GET /fs/file` serves; a read result names one of these before the client asks for the bytes.
// Not every client draws every one: HEIC and TIFF are left to the platform's own decoder.
export const FS_IMAGE_MIMES = [
    'image/png',
    'image/jpeg',
    'image/gif',
    'image/webp',
    'image/avif',
    'image/heic',
    'image/heif',
    'image/bmp',
    'image/x-icon',
    'image/tiff',
    'image/svg+xml'
] as const;

export function isImageMime(mime: string): boolean {
    return (FS_IMAGE_MIMES as readonly string[]).includes(mime);
}

// Container recognition does not imply codec support, so the viewer still checks `canPlayType`.
export const FS_VIDEO_MIMES = ['video/mp4', 'video/webm', 'video/quicktime', 'video/x-matroska', 'video/ogg'] as const;

export function isVideoMime(mime: string): boolean {
    return (FS_VIDEO_MIMES as readonly string[]).includes(mime);
}

export const FS_AUDIO_MIMES = ['audio/mpeg', 'audio/mp4', 'audio/aac', 'audio/wav', 'audio/flac', 'audio/ogg'] as const;

export function isAudioMime(mime: string): boolean {
    return (FS_AUDIO_MIMES as readonly string[]).includes(mime);
}

export const FS_PDF_MIME = 'application/pdf';

export function isPdfMime(mime: string): boolean {
    return mime === FS_PDF_MIME;
}
