import { z } from 'zod';

/*
 * The bytes a client draws that the daemon also serves over HTTP: a chat attachment, a project's image
 * icon and an image, a video, sound or a PDF the file viewer shows. Over a socket the HTTP route is the cheaper way
 * and stays the one used; over a direct connection there is no HTTP, so the same bytes travel as
 * `bytes.read` in pieces the client asks for one after the other.
 */
export const ByteResourceSchema = z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('attachment'), chatId: z.string().min(1), attachmentId: z.string().min(1) }),
    z.object({ kind: z.literal('projectIcon'), projectId: z.string().min(1), theme: z.enum(['light', 'dark']) }),
    z.object({ kind: z.literal('file'), path: z.string().min(1) })
]);
export type ByteResource = z.infer<typeof ByteResourceSchema>;

/*
 * One piece per reply. 256 KiB is about 342 KiB of base64 and 256 KiB in a binary reply, which stays
 * under the output gate's 1 MB high-water mark, so a picture on its way never pauses a terminal on the same connection.
 */
export const BYTES_CHUNK_MAX = 256 * 1024;

// What a client loads whole into memory as one blob. The daemon serves a file of any size, piece by piece.
export const BYTES_READ_MAX_BYTES = 32 * 1024 * 1024;

export const BytesReadPayloadSchema = z.object({
    resource: ByteResourceSchema,
    offset: z.number().int().nonnegative(),
    length: z.number().int().positive().max(BYTES_CHUNK_MAX),
    // Asks for the piece as a binary reply (`encodeBytesReply`); a daemon from before those ignores it and answers in JSON.
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
    data: z.string()
});
export type BytesReadResult = z.infer<typeof BytesReadResultSchema>;

/* A piece without its bytes, which is what a binary reply carries as JSON. */
export const BytesReadHeaderSchema = BytesReadResultSchema.omit({ data: true });
export type BytesReadHeader = z.infer<typeof BytesReadHeaderSchema>;

const BytesReplyHeadSchema = z.object({ id: z.string().min(1), result: BytesReadHeaderSchema });

// The first byte of a binary reply, so a later kind of binary frame can be told apart.
export const BYTES_REPLY_KIND = 1;

const REPLY_PREFIX_BYTES = 5;

// The largest binary reply a client reads: a whole piece and room for its header.
export const BYTES_REPLY_MAX_BYTES = BYTES_CHUNK_MAX + 16 * 1024;

/*
 * A successful `bytes.read` as one binary message, for a request that set `binary`: the kind byte, the
 * length of a JSON header as a big-endian uint32, the header (`{ id, result }`, the result without
 * `data`), then the piece's bytes as they are. An error still answers in JSON.
 */
export function encodeBytesReply(id: string, header: BytesReadHeader, bytes: Uint8Array): Uint8Array<ArrayBuffer> {
    const head = new TextEncoder().encode(JSON.stringify({ id, result: header }));
    const frame = new Uint8Array(REPLY_PREFIX_BYTES + head.byteLength + bytes.byteLength);
    frame[0] = BYTES_REPLY_KIND;
    new DataView(frame.buffer).setUint32(1, head.byteLength);
    frame.set(head, REPLY_PREFIX_BYTES);
    frame.set(bytes, REPLY_PREFIX_BYTES + head.byteLength);
    return frame;
}

export interface BytesReply {
    id: string;
    result: BytesReadHeader;
    bytes: Uint8Array<ArrayBuffer>;
}

/* A binary reply read back, or null for a frame that is not one this version knows. */
export function decodeBytesReply(frame: Uint8Array): BytesReply | null {
    if (frame.byteLength < REPLY_PREFIX_BYTES || frame[0] !== BYTES_REPLY_KIND) {
        return null;
    }
    const headEnd = REPLY_PREFIX_BYTES + new DataView(frame.buffer, frame.byteOffset, frame.byteLength).getUint32(1);
    if (headEnd > frame.byteLength) {
        return null;
    }
    let json: unknown;
    try {
        json = JSON.parse(new TextDecoder().decode(frame.subarray(REPLY_PREFIX_BYTES, headEnd)));
    } catch {
        return null;
    }
    const head = BytesReplyHeadSchema.safeParse(json);
    return head.success ? { id: head.data.id, result: head.data.result, bytes: frame.slice(headEnd) } : null;
}
