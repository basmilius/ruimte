import { CHAT_ATTACHMENTS_MAX_COUNT, CHAT_ATTACHMENT_MAX_BYTES, type ChatAttachmentUpload } from '@ruimte/contracts';
import { credentialFor } from '@/endpoint/credentials';
import { activeEndpoint, endpointById } from '@/state/endpoints';

const ATTACHMENTS_PATH = '/attachments';

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

export const formatBytes = (bytes: number): string => {
    if (bytes < 1024) {
        return `${bytes} B`;
    }
    if (bytes < 1024 * 1024) {
        return `${Math.round(bytes / 1024)} KB`;
    }
    return `${(bytes / 1024 / 1024).toFixed(bytes >= 10 * 1024 * 1024 ? 0 : 1)} MB`;
};

/* Which of the incoming files fit next to what the composer already holds, and why the rest do not. */
export const checkAttachmentLimits = <T extends IncomingFile>(current: number, incoming: T[]): AttachmentCheck<T> => {
    const accepted: T[] = [];
    const rejected: Array<{ name: string; reason: string }> = [];
    for (const file of incoming) {
        if (file.bytes > CHAT_ATTACHMENT_MAX_BYTES) {
            rejected.push({ name: file.name, reason: `Larger than ${formatBytes(CHAT_ATTACHMENT_MAX_BYTES)}` });
        } else if (current + accepted.length >= CHAT_ATTACHMENTS_MAX_COUNT) {
            rejected.push({ name: file.name, reason: `At most ${CHAT_ATTACHMENTS_MAX_COUNT} files per message` });
        } else {
            accepted.push(file);
        }
    }
    return { accepted, rejected };
};

/* The files in a paste or a drop; a paste of plain text gives none. */
export const filesOf = (transfer: DataTransfer | null): File[] => (transfer ? [...transfer.files] : []);

const readAsBase64 = (file: File): Promise<string> =>
    new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onerror = () => reject(reader.error ?? new Error(`Could not read ${file.name}`));
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
            mime: file.type || 'application/octet-stream',
            data: await readAsBase64(file)
        }))
    );

/* A preview of a file the composer still holds; the bytes have not reached the daemon yet. */
export const uploadPreviewUrl = (upload: ChatAttachmentUpload): string => `data:${upload.mime};base64,${upload.data}`;

/* What the file weighs, from the base64 the composer is holding: three bytes per four characters. */
export const uploadBytes = (upload: ChatAttachmentUpload): number => Math.floor((upload.data.length * 3) / 4) - (upload.data.match(/=+$/)?.[0].length ?? 0);

/*
 * Where a sent attachment's bytes come from. They live on the daemon and never travel over the
 * socket again, so the URL carries the endpoint's credential the same way the socket does. The id names
 * one file that never changes, which is what lets the browser cache it forever. The endpoint is the
 * one the thread runs on, which is not the active machine once a second workspace is on screen.
 */
export const attachmentUrl = (chatId: string, attachmentId: string, endpointId?: string): string => {
    const endpoint = (endpointId === undefined ? null : endpointById(endpointId)) ?? activeEndpoint();
    const credential = credentialFor(endpoint);
    const query = credential ? `?token=${encodeURIComponent(credential)}` : '';
    return `${endpoint.httpBaseUrl}${ATTACHMENTS_PATH}/${encodeURIComponent(chatId)}/${encodeURIComponent(attachmentId)}${query}`;
};
