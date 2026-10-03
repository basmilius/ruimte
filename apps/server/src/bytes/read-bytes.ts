import { stat } from 'node:fs/promises';
import { type BytesReadHeader, type BytesReadPayload, type ByteResource, type ChatAttachment } from '@ruimte/contracts';
import { CodedError } from '@ruimte/agents/coded-error';

type BytesErrorCode = 'not-found' | 'bad-offset';

export class BytesError extends CodedError<BytesErrorCode> {}

/*
 * The lookups the HTTP routes make, and nothing more: an attachment only as a chat's thread names it,
 * a project icon only as the folder declares it, and a file only when it is media or text.
 * Access itself was decided when the connection was let in, as `decideAccess` decides it per route.
 */
export interface ByteSources {
    attachment(chatId: string, attachmentId: string): ChatAttachment | null;
    projectIcon(projectId: string, theme: 'light' | 'dark'): Promise<{ path: string; mime: string } | null>;
    file(path: string): Promise<{ mime: string } | null>;
}

const locate = async (sources: ByteSources, resource: ByteResource): Promise<{ path: string; mime: string } | null> => {
    if (resource.kind === 'attachment') {
        const attachment = sources.attachment(resource.chatId, resource.attachmentId);
        return attachment ? { path: attachment.path, mime: attachment.mime } : null;
    }
    if (resource.kind === 'projectIcon') {
        return sources.projectIcon(resource.projectId, resource.theme);
    }
    const served = await sources.file(resource.path).catch(() => null);
    return served ? { path: resource.path, mime: served.mime } : null;
};

export interface BytesPieceRead extends BytesReadHeader {
    bytes: Uint8Array;
}

/*
 * One piece of a resource. Every piece looks the resource up and stats it again, so the daemon holds
 * nothing between two pieces and a client that stops asking costs nothing; the version in each answer
 * is how the client notices a file that changed halfway. A file of any size is served: a piece reads
 * only its own slice, and a video player asks for the ranges it needs.
 */
export const readBytes = async (sources: ByteSources, payload: BytesReadPayload): Promise<BytesPieceRead> => {
    const found = await locate(sources, payload.resource);
    const info = found ? await stat(found.path).catch(() => null) : null;
    if (!found || !info?.isFile()) {
        throw new BytesError('not-found', 'Not a file this machine serves');
    }
    if (payload.offset > info.size) {
        throw new BytesError('bad-offset', `Offset ${payload.offset} is past the end of a file of ${info.size} bytes`);
    }
    const end = Math.min(payload.offset + payload.length, info.size);
    return {
        mime: found.mime,
        size: info.size,
        version: `${Math.trunc(info.mtimeMs)}-${info.size}`,
        offset: payload.offset,
        bytes: new Uint8Array(await Bun.file(found.path).slice(payload.offset, end).arrayBuffer())
    };
};
