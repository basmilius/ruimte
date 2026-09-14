import { z } from 'zod';

/*
 * The bytes a client draws that the daemon also serves over HTTP: a chat attachment, a project's image
 * icon and an image or a video the file viewer shows. Over a socket the HTTP route is the cheaper way
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
 * One piece per reply. 256 KiB is about 342 KiB of base64, which stays under the output gate's 1 MB
 * high-water mark, so a picture on its way never pauses a terminal on the same connection.
 */
export const BYTES_CHUNK_MAX = 256 * 1024;

// More than any image; a longer video than this is one to reveal in the file manager instead.
export const BYTES_READ_MAX_BYTES = 32 * 1024 * 1024;

export const BytesReadPayloadSchema = z.object({
    resource: ByteResourceSchema,
    offset: z.number().int().nonnegative(),
    length: z.number().int().positive().max(BYTES_CHUNK_MAX)
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
