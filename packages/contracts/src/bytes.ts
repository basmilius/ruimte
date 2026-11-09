import { z } from 'zod';

// Longer than any path a file system stores, so an archive entry named past it is not one to read or extract.
export const ARCHIVE_ENTRY_PATH_MAX = 4096;

/*
 * The bytes a client draws that the daemon also serves over HTTP: a chat attachment, a project's image
 * icon and an image, a video, sound or a PDF the file viewer shows. Over a socket the HTTP route is the cheaper way
 * and stays the one used; over a direct connection there is no HTTP, so the same bytes travel as
 * `bytes.read` in pieces the client asks for one after the other.
 */
export const ByteResourceSchema = z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('attachment'), chatId: z.string().min(1), attachmentId: z.string().min(1) }),
    z.object({ kind: z.literal('projectIcon'), projectId: z.string().min(1), theme: z.enum(['light', 'dark']) }),
    // With an `entry`, that entry of the archive at `path`, whole up to `BYTES_READ_MAX_BYTES`, with the mime its own bytes claim.
    z.object({ kind: z.literal('file'), path: z.string().min(1), entry: z.string().min(1).max(ARCHIVE_ENTRY_PATH_MAX).optional() }),
    // A git bundle this machine wrote for a handoff, named by the id `git.bundle` answered.
    z.object({ kind: z.literal('bundle'), bundleId: z.string().min(1).max(64) }),
    // A file of a saved version by its place in the manifest, never by a name or a path.
    z.object({
        kind: z.literal('artifact'),
        artifactId: z.string().min(1).max(64),
        versionId: z.string().min(1).max(64),
        file: z.number().int().nonnegative().max(1024)
    })
]);
export type ByteResource = z.infer<typeof ByteResourceSchema>;

/*
 * One piece per reply. 256 KiB is about 342 KiB of base64 and 256 KiB in a binary reply, which stays
 * under the output gate's 1 MB high-water mark, so a picture on its way never pauses a terminal on the same connection.
 */
export const BYTES_CHUNK_MAX = 256 * 1024;

// The largest bundle either end writes or serves; a checkout that needs more goes through its remote.
export const BUNDLE_MAX_BYTES = 256 * 1024 * 1024;

// What a client loads whole into memory as one blob. The daemon serves a file of any size, piece by piece.
export const BYTES_READ_MAX_BYTES = 32 * 1024 * 1024;

// The largest 3D model an agent attaches to its chat, which a client loads whole to draw it.
export const CHAT_MODEL_MAX_BYTES = 50 * 1024 * 1024;

export const BytesReadPayloadSchema = z.object({
    resource: ByteResourceSchema,
    offset: z.number().int().nonnegative(),
    length: z.number().int().positive().max(BYTES_CHUNK_MAX),
    // Asks for the piece as a binary reply (`encodeBytesReply`); a connection that cannot carry one gets base64 in JSON.
    binary: z.boolean().optional()
});
export type BytesReadPayload = z.infer<typeof BytesReadPayloadSchema>;

export const BytesReadResultSchema = z.object({
    mime: z.string().min(1),
    // The whole resource, so the client knows when it has every piece.
    size: z.number().int().nonnegative(),
    // The file's mtime and size as the daemon read them; a piece with another version belongs to a file that changed in between.
    version: z.string().min(1),
    offset: z.number().int().nonnegative(),
    data: z.string(),
    // A highlighter id for an archive entry that is text, guessed from its name.
    language: z.string().optional()
});
export type BytesReadResult = z.infer<typeof BytesReadResultSchema>;

/* A piece without its bytes, which is what a binary reply carries as JSON. */
export const BytesReadHeaderSchema = BytesReadResultSchema.omit({ data: true });
export type BytesReadHeader = z.infer<typeof BytesReadHeaderSchema>;

const BytesReplyHeadSchema = z.object({ id: z.string().min(1), result: BytesReadHeaderSchema });

// The first byte of a binary reply, so a later kind of binary frame can be told apart.
export const BYTES_REPLY_KIND = 1;

const HEADED_PREFIX_BYTES = 5;

// The largest binary reply a client reads: a whole piece and room for its header.
export const BYTES_REPLY_MAX_BYTES = BYTES_CHUNK_MAX + 16 * 1024;

/*
 * A binary frame of any kind: the kind byte, the length of a JSON head as a big-endian uint32, the
 * head, then the bytes as they are.
 */
export function encodeHeadedFrame(kind: number, head: unknown, bytes: Uint8Array): Uint8Array<ArrayBuffer> {
    const encodedHead = new TextEncoder().encode(JSON.stringify(head));
    const frame = new Uint8Array(HEADED_PREFIX_BYTES + encodedHead.byteLength + bytes.byteLength);
    frame[0] = kind;
    new DataView(frame.buffer).setUint32(1, encodedHead.byteLength);
    frame.set(encodedHead, HEADED_PREFIX_BYTES);
    frame.set(bytes, HEADED_PREFIX_BYTES + encodedHead.byteLength);
    return frame;
}

export function decodeHeadedFrame(frame: Uint8Array, kind: number): { head: unknown; bytes: Uint8Array<ArrayBuffer> } | null {
    if (frame.byteLength < HEADED_PREFIX_BYTES || frame[0] !== kind) {
        return null;
    }
    const headEnd = HEADED_PREFIX_BYTES + new DataView(frame.buffer, frame.byteOffset, frame.byteLength).getUint32(1);
    if (headEnd > frame.byteLength) {
        return null;
    }
    try {
        return { head: JSON.parse(new TextDecoder().decode(frame.subarray(HEADED_PREFIX_BYTES, headEnd))), bytes: frame.slice(headEnd) };
    } catch {
        return null;
    }
}

/*
 * A successful `bytes.read` as one binary message, for a request that set `binary`: a headed frame
 * whose head is `{ id, result }`, the result without `data`. An error still answers in JSON.
 */
export function encodeBytesReply(id: string, header: BytesReadHeader, bytes: Uint8Array): Uint8Array<ArrayBuffer> {
    return encodeHeadedFrame(BYTES_REPLY_KIND, { id, result: header }, bytes);
}

export interface BytesReply {
    id: string;
    result: BytesReadHeader;
    bytes: Uint8Array<ArrayBuffer>;
}

/* A binary reply read back, or null for a frame that is not one this version knows. */
export function decodeBytesReply(frame: Uint8Array): BytesReply | null {
    const decoded = decodeHeadedFrame(frame, BYTES_REPLY_KIND);
    if (decoded === null) {
        return null;
    }
    const head = BytesReplyHeadSchema.safeParse(decoded.head);
    return head.success ? { id: head.data.id, result: head.data.result, bytes: decoded.bytes } : null;
}

export const BYTES_REQUEST_SCHEMAS = {
    'bytes.read': { payload: BytesReadPayloadSchema, result: BytesReadResultSchema }
} as const;
