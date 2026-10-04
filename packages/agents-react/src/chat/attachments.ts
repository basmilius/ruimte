import i18next from 'i18next';
import {
    attachmentBytes,
    attachmentImageMime,
    CHAT_ATTACHMENTS_MAX_BYTES,
    CHAT_ATTACHMENTS_MAX_COUNT,
    CHAT_ATTACHMENT_MAX_BYTES,
    type ChatAttachment,
    type ChatAttachmentUpload
} from '@ruimte/agent-contracts';
import { formatBytes as bytesOf } from '@basmilius/desktop-ui/format';

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

export function isImageAttachment(mime: string): boolean {
    return mime.startsWith('image/');
}

/* The type on a file card: the extension, as long as it is short enough to read as one. */
export function fileBadge(name: string): string | null {
    const dot = name.lastIndexOf('.');
    if (dot <= 0 || dot === name.length - 1) {
        return null;
    }
    const extension = name.slice(dot + 1);
    return extension.length <= 5 ? extension.toUpperCase() : null;
}

/* Whole kilobytes, which is all a row under a file name has room for, and a decimal once it runs into megabytes. */
export function formatBytes(bytes: number): string {
    return bytesOf(bytes, bytes < 1024 * 1024);
}

/* Which of the incoming files fit next to what the composer already holds, and why the rest do not. */
export function checkAttachmentLimits<T extends IncomingFile>(current: number, incoming: T[], currentBytes = 0): AttachmentCheck<T> {
    const accepted: T[] = [];
    const rejected: Array<{ name: string; reason: string }> = [];
    let bytes = currentBytes;
    for (const file of incoming) {
        if (file.bytes === 0) {
            rejected.push({ name: file.name, reason: i18next.t('agent-chat:attachments.rejected.empty') });
        } else if (file.bytes > CHAT_ATTACHMENT_MAX_BYTES) {
            rejected.push({ name: file.name, reason: i18next.t('agent-chat:attachments.rejected.tooLarge', { size: formatBytes(CHAT_ATTACHMENT_MAX_BYTES) }) });
        } else if (current + accepted.length >= CHAT_ATTACHMENTS_MAX_COUNT) {
            rejected.push({ name: file.name, reason: i18next.t('agent-chat:attachments.rejected.tooMany', { count: CHAT_ATTACHMENTS_MAX_COUNT }) });
        } else if (bytes + file.bytes > CHAT_ATTACHMENTS_MAX_BYTES) {
            rejected.push({
                name: file.name,
                reason: i18next.t('agent-chat:attachments.rejected.tooHeavy', { size: formatBytes(CHAT_ATTACHMENTS_MAX_BYTES) })
            });
        } else {
            accepted.push(file);
            bytes += file.bytes;
        }
    }
    return { accepted, rejected };
}

/* The files in a paste or a drop; a paste of plain text gives none. */
export function filesOf(transfer: DataTransfer | null): File[] {
    return transfer ? [...transfer.files] : [];
}

function readAsBase64(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onerror = () => reject(reader.error ?? new Error(i18next.t('agent-chat:attachments.unreadable', { name: file.name })));
        reader.onload = () => {
            const url = String(reader.result);
            resolve(url.slice(url.indexOf(',') + 1));
        };
        reader.readAsDataURL(file);
    });
}

// A pasted screenshot has no name; the clock gives it one so the row and the agent can tell them apart.
function nameFor(file: File, index: number): string {
    return file.name || `pasted-${Date.now()}-${index + 1}.${file.type.split('/')[1] ?? 'bin'}`;
}

export async function readAttachments(files: File[]): Promise<ChatAttachmentUpload[]> {
    return Promise.all(
        files.map(async (file, index) => ({
            name: nameFor(file, index),
            mime: attachmentImageMime({ name: file.name, mime: file.type }) ?? (file.type || 'application/octet-stream'),
            data: await readAsBase64(file)
        }))
    );
}

/* Files the host already stored for a chat, back as uploads the composer can hold again. */
export async function readStoredAttachments(
    read: (attachment: ChatAttachment) => Promise<Blob>,
    stored: readonly ChatAttachment[]
): Promise<ChatAttachmentUpload[]> {
    const files = await Promise.all(stored.map(async (attachment) => new File([await read(attachment)], attachment.name, { type: attachment.mime })));
    return readAttachments(files);
}

/* A preview of a file the composer still holds; the bytes have not reached the host yet. */
export function uploadPreviewUrl(upload: ChatAttachmentUpload): string {
    return `data:${upload.mime};base64,${upload.data}`;
}

/* What the file weighs, from the base64 the composer is holding: three bytes per four characters. */
export function uploadBytes(upload: ChatAttachmentUpload): number {
    return attachmentBytes(upload.data);
}
