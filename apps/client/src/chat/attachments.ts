import i18next from 'i18next';
import {
    attachmentBytes,
    attachmentImageMime,
    CHAT_ATTACHMENTS_MAX_BYTES,
    CHAT_ATTACHMENTS_MAX_COUNT,
    CHAT_ATTACHMENT_MAX_BYTES,
    type ChatAttachment,
    type ChatAttachmentUpload
} from '@ruimte/contracts';
import { formatBytes as bytesOf } from '@/format/number';
import { readResource, type ReadPiece } from '@/transport/byte-transfer';

interface IncomingFile {
    name: string;
    mime: string;
    // Decoded size; the base64 the wire carries is a third larger.
    bytes: number;
}

interface AttachmentCheck<T extends IncomingFile> {
    accepted: T[];
    rejected: Array<{ name: string; reason: string }>;
}

export const isImageAttachment = (mime: string): boolean => mime.startsWith('image/');

/* Whole kilobytes, which is all a row under a file name has room for, and a decimal once it runs into megabytes. */
export const formatBytes = (bytes: number): string => bytesOf(bytes, bytes < 1024 * 1024);

/* Which of the incoming files fit next to what the composer already holds, and why the rest do not. */
export const checkAttachmentLimits = <T extends IncomingFile>(current: number, incoming: T[], currentBytes = 0): AttachmentCheck<T> => {
    const accepted: T[] = [];
    const rejected: Array<{ name: string; reason: string }> = [];
    let bytes = currentBytes;
    for (const file of incoming) {
        if (file.bytes === 0) {
            rejected.push({ name: file.name, reason: i18next.t('chat:attachments.rejected.empty') });
        } else if (file.bytes > CHAT_ATTACHMENT_MAX_BYTES) {
            rejected.push({ name: file.name, reason: i18next.t('chat:attachments.rejected.tooLarge', { size: formatBytes(CHAT_ATTACHMENT_MAX_BYTES) }) });
        } else if (current + accepted.length >= CHAT_ATTACHMENTS_MAX_COUNT) {
            rejected.push({ name: file.name, reason: i18next.t('chat:attachments.rejected.tooMany', { count: CHAT_ATTACHMENTS_MAX_COUNT }) });
        } else if (bytes + file.bytes > CHAT_ATTACHMENTS_MAX_BYTES) {
            rejected.push({
                name: file.name,
                reason: i18next.t('chat:attachments.rejected.tooHeavy', { size: formatBytes(CHAT_ATTACHMENTS_MAX_BYTES) })
            });
        } else {
            accepted.push(file);
            bytes += file.bytes;
        }
    }
    return { accepted, rejected };
};

/* The files in a paste or a drop; a paste of plain text gives none. */
export const filesOf = (transfer: DataTransfer | null): File[] => (transfer ? [...transfer.files] : []);

const readAsBase64 = (file: File): Promise<string> =>
    new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onerror = () => reject(reader.error ?? new Error(i18next.t('chat:attachments.unreadable', { name: file.name })));
        reader.onload = () => {
            const url = String(reader.result);
            resolve(url.slice(url.indexOf(',') + 1));
        };
        reader.readAsDataURL(file);
    });

// A pasted screenshot has no name; the clock gives it one so the row and the agent can tell them apart.
const nameFor = (file: File, index: number): string => file.name || `pasted-${Date.now()}-${index + 1}.${file.type.split('/')[1] ?? 'bin'}`;

export const readAttachments = async (files: File[]): Promise<ChatAttachmentUpload[]> =>
    Promise.all(
        files.map(async (file, index) => ({
            name: nameFor(file, index),
            mime: attachmentImageMime({ name: file.name, mime: file.type }) ?? (file.type || 'application/octet-stream'),
            data: await readAsBase64(file)
        }))
    );

/* Files the machine already stored for a chat, back as uploads the composer can hold again. */
export const readStoredAttachments = async (read: ReadPiece, chatId: string, stored: readonly ChatAttachment[]): Promise<ChatAttachmentUpload[]> => {
    const files = await Promise.all(
        stored.map(
            async (attachment) =>
                new File([await readResource(read, { kind: 'attachment', chatId, attachmentId: attachment.id })], attachment.name, { type: attachment.mime })
        )
    );
    return readAttachments(files);
};

/* A preview of a file the composer still holds; the bytes have not reached the daemon yet. */
export const uploadPreviewUrl = (upload: ChatAttachmentUpload): string => `data:${upload.mime};base64,${upload.data}`;

/* What the file weighs, from the base64 the composer is holding: three bytes per four characters. */
export const uploadBytes = (upload: ChatAttachmentUpload): number => attachmentBytes(upload.data);
