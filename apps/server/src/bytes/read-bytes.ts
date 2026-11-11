import { stat } from 'node:fs/promises';
import { CodedError } from '@adecore/agents';
import { BUNDLE_MAX_BYTES, type BytesReadHeader, type BytesReadPayload, type ByteResource, type ChatAttachment } from '@ruimte/contracts';

type BytesErrorCode = 'not-found' | 'bad-offset' | 'bundle-too-large';

export class BytesError extends CodedError<BytesErrorCode> {}

/*
 * The lookups the HTTP routes make, and nothing more: an attachment only as a chat's thread names it,
 * a project icon only as the folder declares it, and a file only when it is media or text.
 * Access itself was decided when the connection was let in, as `decideAccess` decides it per route.
 */
export interface ByteSources {
    attachment(chatId: string, attachmentId: string): Promise<ChatAttachment | null>;
    projectIcon(projectId: string, theme: 'light' | 'dark'): Promise<{ path: string; mime: string } | null>;
    file(path: string): Promise<{ mime: string } | null>;
    /* One entry of an archive whole, with what its own bytes claim to be. */
    archiveEntry?(path: string, entry: string): Promise<{ bytes: Uint8Array; mime: string; version: string; language?: string }>;
    /* The file of a bundle this machine wrote. */
    bundle?(bundleId: string): Promise<string | null>;
    /* A bundle was read to its last byte, so nobody needs the file again. */
    bundleRead?(bundleId: string): Promise<void>;
    /* A file of a saved version, found in the register by its ids only; its hash is its version, since it never changes. */
    artifact?(artifactId: string, versionId: string, file: number): Promise<{ path: string; mime: string; sha256: string } | null>;
    /* A design page this machine built and holds for `design.page`. */
    designPage?(pageId: string): Uint8Array | null;
    /* A piece of that page went out. */
    designPageSent?(pageId: string, length: number): void;
}

async function locate(
    sources: ByteSources,
    resource: Exclude<ByteResource, { kind: 'designPage' }>
): Promise<{ path: string; mime: string; version?: string } | null> {
    if (resource.kind === 'artifact') {
        const found = await sources.artifact?.(resource.artifactId, resource.versionId, resource.file);
        return found ? { path: found.path, mime: found.mime, version: found.sha256 } : null;
    }
    if (resource.kind === 'attachment') {
        const attachment = await sources.attachment(resource.chatId, resource.attachmentId);
        return attachment ? { path: attachment.path, mime: attachment.mime } : null;
    }
    if (resource.kind === 'projectIcon') {
        return sources.projectIcon(resource.projectId, resource.theme);
    }
    if (resource.kind === 'bundle') {
        const path = await sources.bundle?.(resource.bundleId);
        return path ? { path, mime: 'application/x-git-bundle' } : null;
    }
    const served = await sources.file(resource.path).catch(() => null);
    return served ? { path: resource.path, mime: served.mime } : null;
}

interface BytesPieceRead extends BytesReadHeader {
    bytes: Uint8Array;
}

/*
 * One piece of a resource. Every piece looks the resource up and stats it again, so the daemon holds
 * nothing between two pieces and a client that stops asking costs nothing; the version in each answer
 * is how the client notices a file that changed halfway. A file of any size is served: a piece reads
 * only its own slice, and a video player asks for the ranges it needs.
 */
export async function readBytes(sources: ByteSources, payload: BytesReadPayload): Promise<BytesPieceRead> {
    const { resource } = payload;
    if (resource.kind === 'file' && resource.entry !== undefined) {
        return readEntryPiece(sources, resource.path, resource.entry, payload);
    }
    if (resource.kind === 'designPage') {
        return readDesignPagePiece(sources, resource.pageId, payload);
    }
    const found = await locate(sources, resource);
    const info = found ? await stat(found.path).catch(() => null) : null;
    if (!found || !info?.isFile()) {
        throw new BytesError('not-found', 'Not a file this machine serves');
    }
    if (resource.kind === 'bundle' && info.size > BUNDLE_MAX_BYTES) {
        throw new BytesError('bundle-too-large', 'A bundle this large is not sent. Push the branch to origin and fetch it there instead.');
    }
    if (payload.offset > info.size) {
        throw new BytesError('bad-offset', `Offset ${payload.offset} is past the end of a file of ${info.size} bytes`);
    }
    const end = Math.min(payload.offset + payload.length, info.size);
    const piece = new Uint8Array(await Bun.file(found.path).slice(payload.offset, end).arrayBuffer());
    if (resource.kind === 'bundle' && end === info.size) {
        await sources.bundleRead?.(resource.bundleId);
    }
    return {
        mime: found.mime,
        size: info.size,
        version: found.version ?? `${Math.trunc(info.mtimeMs)}-${info.size}`,
        offset: payload.offset,
        bytes: piece
    };
}

/* A piece of a held design page; its id is its version, since a page is never built again under the same id. */
function readDesignPagePiece(sources: ByteSources, pageId: string, payload: BytesReadPayload): BytesPieceRead {
    const bytes = sources.designPage?.(pageId) ?? null;
    if (bytes === null) {
        throw new BytesError('not-found', 'Not a design page this machine holds');
    }
    if (payload.offset > bytes.length) {
        throw new BytesError('bad-offset', `Offset ${payload.offset} is past the end of a page of ${bytes.length} bytes`);
    }
    const piece = bytes.subarray(payload.offset, Math.min(payload.offset + payload.length, bytes.length));
    sources.designPageSent?.(pageId, piece.length);
    return { mime: 'text/html; charset=utf-8', size: bytes.length, version: pageId, offset: payload.offset, bytes: piece };
}

/* A piece of an archive entry, cut from the entry the source unpacked whole; the source keeps it for the pieces after. */
async function readEntryPiece(sources: ByteSources, path: string, entry: string, payload: BytesReadPayload): Promise<BytesPieceRead> {
    if (sources.archiveEntry === undefined) {
        throw new BytesError('not-found', 'Not a file this machine serves');
    }
    const read = await sources.archiveEntry(path, entry);
    if (payload.offset > read.bytes.length) {
        throw new BytesError('bad-offset', `Offset ${payload.offset} is past the end of an entry of ${read.bytes.length} bytes`);
    }
    return {
        mime: read.mime,
        size: read.bytes.length,
        version: read.version,
        offset: payload.offset,
        bytes: read.bytes.subarray(payload.offset, Math.min(payload.offset + payload.length, read.bytes.length)),
        ...(read.language === undefined ? {} : { language: read.language })
    };
}
