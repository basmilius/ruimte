import { z } from 'zod';
import { FsCreateResultSchema } from './fs.ts';

export const ChatImageTargetPayloadSchema = z.object({
    chatId: z.string().min(1),
    attachmentId: z.string().min(1),
    path: z.string().min(1).optional()
});
export type ChatImageTargetPayload = z.infer<typeof ChatImageTargetPayloadSchema>;

export const ChatImageTargetResultSchema = z.object({
    folder: z.string(),
    projectName: z.string(),
    name: z.string(),
    exists: z.boolean(),
    revision: z.string().nullable()
});
export type ChatImageTargetResult = z.infer<typeof ChatImageTargetResultSchema>;

export const ChatImageSavePayloadSchema = ChatImageTargetPayloadSchema.extend({
    path: z.string().min(1),
    replace: z.string().min(1).optional()
});
export type ChatImageSavePayload = z.infer<typeof ChatImageSavePayloadSchema>;

export const ChatImageSaveResultSchema = FsCreateResultSchema.extend({ path: z.string() });
export type ChatImageSaveResult = z.infer<typeof ChatImageSaveResultSchema>;

function startsWith(bytes: Uint8Array, prefix: readonly number[], at = 0): boolean {
    return prefix.every((byte, index) => bytes[at + index] === byte);
}

function ascii(text: string): number[] {
    return [...text].map((character) => character.charCodeAt(0));
}

/* The image type its leading bytes say, for the four types an attachment may be; null for anything else. */
export function sniffImageMime(bytes: Uint8Array): 'image/png' | 'image/jpeg' | 'image/gif' | 'image/webp' | null {
    if (bytes.length >= 33 && startsWith(bytes, [137, 80, 78, 71, 13, 10, 26, 10])) {
        return 'image/png';
    }
    if (bytes.length >= 4 && startsWith(bytes, [255, 216, 255])) {
        return 'image/jpeg';
    }
    if (bytes.length >= 13 && (startsWith(bytes, ascii('GIF87a')) || startsWith(bytes, ascii('GIF89a')))) {
        return 'image/gif';
    }
    if (bytes.length >= 20 && startsWith(bytes, ascii('RIFF')) && startsWith(bytes, ascii('WEBP'), 8)) {
        return 'image/webp';
    }
    return null;
}
