import { stat } from 'node:fs/promises';
import { BYTES_READ_MAX_BYTES, type BytesReadPayload, type BytesReadResult, type ByteResource, type ChatAttachment } from '@ruimte/contracts';
import { CodedError } from '../coded-error.ts';

type BytesErrorCode = 'not-found' | 'too-large' | 'bad-offset';

export class BytesError extends CodedError<BytesErrorCode> {}

/*
 * The lookups the HTTP routes make, and nothing more: an attachment only as a chat's thread names it,
 * a project icon only as the folder declares it, and a file only when it is an image or a video.
 * Access itself was decided when the connection was let in, as `decideAccess` decides it per route.
 */
export interface ByteSources {
    attachment(chatId: string, attachmentId: string): ChatAttachment | null;
    projectIcon(projectId: string, theme: 'light' | 'dark'): Promise<{ path: string; mime: string } | null>;
    media(path: string): Promise<{ mime: string } | null>;
}

const MIB = 1024 * 1024;

const megabytes = (bytes: number): string => `${Math.ceil(bytes / MIB)} MB`;

const locate = async (sources: ByteSources, resource: ByteResource): Promise<{ path: string; mime: string } | null> => {
    if (resource.kind === 'attachment') {
        const attachment = sources.attachment(resource.chatId, resource.attachmentId);
        return attachment ? { path: attachment.path, mime: attachment.mime } : null;
    }
    if (resource.kind === 'projectIcon') {
        return sources.projectIcon(resource.projectId, resource.theme);
    }
    const media = await sources.media(resource.path).catch(() => null);
    return media ? { path: resource.path, mime: media.mime } : null;
};

/*
 * One piece of a resource. Every piece looks the resource up and stats it again, so the daemon holds
 * nothing between two pieces and a client that stops asking costs nothing; the version in each answer
 * is how the client notices a file that changed halfway.
 */
export const readBytes = async (sources: ByteSources, payload: BytesReadPayload, maxBytes: number = BYTES_READ_MAX_BYTES): Promise<BytesReadResult> => {
    const found = await locate(sources, payload.resource);
    const info = found ? await stat(found.path).catch(() => null) : null;
    if (!found || !info?.isFile()) {
        throw new BytesError('not-found', 'Not a file this machine serves');
    }
    if (info.size > maxBytes) {
        throw new BytesError('too-large', `This file is ${megabytes(info.size)}; at most ${megabytes(maxBytes)} loads over a direct connection`);
    }
    if (payload.offset > info.size) {
        throw new BytesError('bad-offset', `Offset ${payload.offset} is past the end of a file of ${info.size} bytes`);
    }
    const end = Math.min(payload.offset + payload.length, info.size);
    const bytes = await Bun.file(found.path).slice(payload.offset, end).arrayBuffer();
    return {
        mime: found.mime,
        size: info.size,
        version: `${Math.trunc(info.mtimeMs)}-${info.size}`,
        offset: payload.offset,
        data: Buffer.from(bytes).toString('base64')
    };
};
