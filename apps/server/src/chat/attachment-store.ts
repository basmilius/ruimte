import { randomBytes } from 'node:crypto';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { extname, join } from 'node:path';
import { attachmentImageMime, type ChatAttachment, type ChatAttachmentUpload } from '@ruimte/contracts';

// The extension the file gets on disk when its name does not carry a usable one.
const EXTENSIONS: Record<string, string> = {
    'image/png': 'png',
    'image/jpeg': 'jpg',
    'image/gif': 'gif',
    'image/webp': 'webp',
    'image/svg+xml': 'svg',
    'application/pdf': 'pdf',
    'application/json': 'json',
    'text/csv': 'csv',
    'text/markdown': 'md',
    'text/plain': 'txt'
};

const SAFE_EXTENSION = /^[A-Za-z0-9]{1,8}$/;

/* What the file is called on disk: the id, plus an extension the agent's tools can recognize. */
export const extensionFor = (name: string, mime: string): string => {
    const own = extname(name).slice(1).toLowerCase();
    if (SAFE_EXTENSION.test(own)) {
        return own;
    }
    const known = EXTENSIONS[mime.toLowerCase()];
    if (known) {
        return known;
    }
    const subtype = mime.split('/')[1]?.replace(/\+.*$/, '') ?? '';
    return SAFE_EXTENSION.test(subtype) ? subtype.toLowerCase() : 'bin';
};

/*
 * The files people attach to a message, under `$RUIMTE_HOME/attachments/<chatId>`. The thread keeps
 * only what a row needs (name, mime, size, path); the bytes stay on disk, so a thread with a video
 * in it is still a small JSON file.
 */
export class AttachmentStore {
    readonly dir: string;

    constructor(home: string) {
        this.dir = join(home, 'attachments');
    }

    /* Writes one upload and answers the metadata the thread stores. */
    async save(chatId: string, upload: ChatAttachmentUpload): Promise<ChatAttachment> {
        const bytes = Buffer.from(upload.data, 'base64');
        const mime = attachmentImageMime(upload) ?? upload.mime;
        const id = randomBytes(8).toString('hex');
        const folder = this.folder(chatId);
        await mkdir(folder, { recursive: true, mode: 0o700 });
        const path = join(folder, `${id}.${extensionFor(upload.name, mime)}`);
        await writeFile(path, bytes, { mode: 0o600 });
        return { id, name: upload.name, mime, size: bytes.byteLength, path };
    }

    /* Everything a chat attached; used when the chat itself is deleted. */
    async removeAll(chatId: string): Promise<void> {
        await rm(this.folder(chatId), { recursive: true, force: true });
    }

    private folder(chatId: string): string {
        return join(this.dir, encodeURIComponent(chatId));
    }
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);

// What an attachment looked like before the files moved out of the thread: the bytes inline.
const isInline = (value: unknown): value is { name: string; mediaType: string; data: string } =>
    isRecord(value) && typeof value.name === 'string' && typeof value.mediaType === 'string' && typeof value.data === 'string';

/*
 * Writes out the images a thread still carries inline and answers the record with metadata in their
 * place, or null when there was nothing to do. Old records are migrated on the read that opens the
 * chat, before the schema sees them, because the schema no longer knows the inline shape.
 */
export const migrateInlineAttachments = async (chatId: string, record: unknown, store: AttachmentStore): Promise<unknown | null> => {
    const items = isRecord(record) && Array.isArray(record.items) ? record.items : null;
    if (!items) {
        return null;
    }
    let migrated = false;
    const next = await Promise.all(
        items.map(async (item) => {
            if (!isRecord(item) || !Array.isArray(item.attachments) || !item.attachments.some(isInline)) {
                return item;
            }
            const attachments = await Promise.all(
                item.attachments.map(async (attachment) => {
                    if (!isInline(attachment)) {
                        return attachment;
                    }
                    migrated = true;
                    return await store.save(chatId, { name: attachment.name, mime: attachment.mediaType, data: attachment.data });
                })
            );
            return { ...item, attachments };
        })
    );
    return migrated ? { ...(record as Record<string, unknown>), items: next } : null;
};
