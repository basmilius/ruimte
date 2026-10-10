import { randomUUID } from 'node:crypto';
import { constants, type Stats } from 'node:fs';
import { link, lstat, open, realpath, rename, rm } from 'node:fs/promises';
import { basename, dirname, join, relative, resolve, sep } from 'node:path';
import {
    CHAT_ATTACHMENT_MAX_BYTES,
    type ChatAttachment,
    type ChatImageSavePayload,
    type ChatImageSaveResult,
    type ChatImageTargetPayload,
    type ChatImageTargetResult,
    sniffImageMime
} from '@ruimte/contracts';
import { CodedError } from '@adecore/agents/coded-error';
import { isInside } from '../canvas/project-paths.ts';
import { isRuimteState } from '../projects/project-files.ts';

export class ImageFileError extends CodedError {}

export interface ImageFileSources {
    project(chatId: string, clientId: string): Promise<{ folder: string; name: string } | null>;
    attachment(chatId: string, attachmentId: string): Promise<ChatAttachment | null>;
    refusePath(path: string): Promise<void>;
}

function revision(file: Stats): string {
    return `${file.dev}:${file.ino}:${file.size}:${file.mtimeMs}:${file.ctimeMs}`;
}

async function existing(path: string): Promise<Stats | null> {
    return lstat(path).catch((error: NodeJS.ErrnoException) => {
        if (error.code === 'ENOENT') {
            return null;
        }
        throw error;
    });
}

async function destination(folder: string, path: string): Promise<string> {
    if (path.includes('\0')) {
        throw new ImageFileError('bad-path', 'That path is not a file name');
    }
    const root = await realpath(folder);
    const target = resolve(folder, path);
    const parent = await realpath(dirname(target)).catch(() => null);
    if (parent === null) {
        throw new ImageFileError('not-a-directory', 'The destination folder is not there');
    }
    const actual = join(parent, basename(target));
    if (!isInside(root, actual) || actual === root) {
        throw new ImageFileError('outside-project', 'The image must stay inside its project');
    }
    const segments = relative(root, actual).split(sep);
    if (segments.includes('.git') || isRuimteState(segments)) {
        throw new ImageFileError('project-state', 'The image cannot replace repository or project state');
    }
    const file = await existing(actual);
    if (file !== null && !file.isFile()) {
        throw new ImageFileError('not-a-file', 'The destination is not a regular file');
    }
    return actual;
}

/* The bytes of an attached image, refused when they changed while read or are no image of its type. */
async function imageBytes(attachment: ChatAttachment): Promise<Uint8Array> {
    const source = await open(attachment.path, constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
        const file = await source.stat();
        if (!file.isFile() || file.size === 0 || file.size > CHAT_ATTACHMENT_MAX_BYTES) {
            throw new ImageFileError('invalid-image', 'The attached image is empty or too large');
        }
        const buffer = new Uint8Array(Math.min(file.size + 1, CHAT_ATTACHMENT_MAX_BYTES + 1));
        let offset = 0;
        while (offset < buffer.length) {
            const read = await source.read(buffer, offset, buffer.length - offset, offset);
            if (read.bytesRead === 0) {
                break;
            }
            offset += read.bytesRead;
        }
        const bytes = buffer.subarray(0, offset);
        if (bytes.length !== file.size || sniffImageMime(bytes) !== attachment.mime) {
            throw new ImageFileError('invalid-image', 'The attached image changed or is not an image');
        }
        return bytes;
    } finally {
        await source.close();
    }
}

export class ChatImageFiles {
    private readonly sources: ImageFileSources;
    private readonly writes = new Set<string>();

    constructor(sources: ImageFileSources) {
        this.sources = sources;
    }

    private async destination(folder: string, path: string): Promise<string> {
        const actual = await destination(folder, path);
        await this.sources.refusePath(actual);
        return actual;
    }

    private async source(payload: ChatImageTargetPayload, clientId: string) {
        const project = await this.sources.project(payload.chatId, clientId);
        if (project === null) {
            throw new ImageFileError('outside-project', 'Open the project of this chat before saving its image');
        }
        const attachment = await this.sources.attachment(payload.chatId, payload.attachmentId);
        if (attachment === null || !['image/png', 'image/jpeg', 'image/gif', 'image/webp'].includes(attachment.mime)) {
            throw new ImageFileError('not-found', 'This chat keeps no image under that attachment id');
        }
        return { project, attachment };
    }

    async target(payload: ChatImageTargetPayload, clientId: string): Promise<ChatImageTargetResult> {
        const { project, attachment } = await this.source(payload, clientId);
        const file = payload.path === undefined ? null : await existing(await this.destination(project.folder, payload.path));
        return {
            folder: project.folder,
            projectName: project.name,
            name: attachment.name,
            exists: file !== null,
            revision: file === null ? null : revision(file)
        };
    }

    async save(payload: ChatImageSavePayload, clientId: string): Promise<ChatImageSaveResult> {
        const { project, attachment } = await this.source(payload, clientId);
        const path = await this.destination(project.folder, payload.path);
        if (this.writes.has(path)) {
            throw new ImageFileError('busy', 'This image destination is already being written');
        }
        this.writes.add(path);
        const temporary = join(dirname(path), `.ruimte-image-${randomUUID()}.tmp`);
        try {
            const before = await existing(path);
            if (before !== null && payload.replace === undefined) {
                throw new ImageFileError('exists', 'That file already exists; choose another name or Replace');
            }
            if (payload.replace !== undefined && (before === null || revision(before) !== payload.replace)) {
                throw new ImageFileError('stale', 'The destination changed since it was checked');
            }
            const bytes = await imageBytes(attachment);
            const output = await open(
                temporary,
                constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW,
                before === null ? 0o644 : before.mode & 0o777
            );
            try {
                await output.writeFile(bytes);
            } finally {
                await output.close();
            }
            // Recheck canonical parents after reading the source; neither links nor a stale Replace grant a wider destination.
            if ((await this.destination(project.folder, payload.path)) !== path) {
                throw new ImageFileError('stale', 'The destination folder changed while the image was being saved');
            }
            if (payload.replace === undefined) {
                await link(temporary, path).catch((error: NodeJS.ErrnoException) => {
                    if (error.code === 'EEXIST') {
                        throw new ImageFileError('exists', 'That file appeared while the image was being saved');
                    }
                    throw error;
                });
            } else {
                const current = await existing(path);
                if (current === null || revision(current) !== payload.replace) {
                    throw new ImageFileError('stale', 'The destination changed while the image was being saved');
                }
                await rename(temporary, path);
            }
            const saved = await lstat(path);
            return { path, size: saved.size, mtime: Math.round(saved.mtimeMs) };
        } finally {
            this.writes.delete(path);
            await rm(temporary, { force: true });
        }
    }
}
