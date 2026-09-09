import {
    CHAT_ATTACHMENTS_MAX_COUNT,
    CHAT_ATTACHMENT_MAX_BYTES,
    ChatAttachmentMediaTypeSchema,
    type ChatAttachment,
    type ChatAttachmentMediaType
} from '@ruimte/contracts';

export interface IncomingImage {
    name: string;
    mediaType: string;
    // Decoded size; the base64 the wire carries is a third larger.
    bytes: number;
}

export interface AttachmentCheck<T extends IncomingImage> {
    accepted: T[];
    rejected: Array<{ name: string; reason: string }>;
}

export const isAttachmentMediaType = (value: string): value is ChatAttachmentMediaType => ChatAttachmentMediaTypeSchema.safeParse(value).success;

const formatMb = (bytes: number): string => `${(bytes / 1024 / 1024).toFixed(bytes >= 1024 * 1024 ? 0 : 1)} MB`;

/* Which of the incoming images fit next to what the composer already holds, and why the rest do not. */
export const checkAttachmentLimits = <T extends IncomingImage>(current: number, incoming: T[]): AttachmentCheck<T> => {
    const accepted: T[] = [];
    const rejected: Array<{ name: string; reason: string }> = [];
    for (const image of incoming) {
        if (!isAttachmentMediaType(image.mediaType)) {
            rejected.push({ name: image.name, reason: 'Only PNG, JPEG, GIF and WebP images can be attached' });
        } else if (image.bytes > CHAT_ATTACHMENT_MAX_BYTES) {
            rejected.push({ name: image.name, reason: `Larger than ${formatMb(CHAT_ATTACHMENT_MAX_BYTES)}` });
        } else if (current + accepted.length >= CHAT_ATTACHMENTS_MAX_COUNT) {
            rejected.push({ name: image.name, reason: `At most ${CHAT_ATTACHMENTS_MAX_COUNT} images per message` });
        } else {
            accepted.push(image);
        }
    }
    return { accepted, rejected };
};

/* The image files in a paste or drop; a paste of text or of a file that is not an image gives none. */
export const imageFilesOf = (transfer: DataTransfer | null): File[] => {
    if (!transfer) {
        return [];
    }
    return [...transfer.files].filter((file) => file.type.startsWith('image/'));
};

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
const nameFor = (file: File, index: number): string => file.name || `pasted-${Date.now()}-${index + 1}.${file.type.slice('image/'.length)}`;

export const readAttachments = async (files: File[]): Promise<ChatAttachment[]> =>
    Promise.all(
        files.map(async (file, index) => ({
            name: nameFor(file, index),
            mediaType: file.type as ChatAttachmentMediaType,
            data: await readAsBase64(file)
        }))
    );

export const attachmentUrl = (attachment: ChatAttachment): string => `data:${attachment.mediaType};base64,${attachment.data}`;
