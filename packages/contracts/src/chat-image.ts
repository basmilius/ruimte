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

/* The raster image types a chat can display, identified by their bytes rather than their name. */
export function sniffImageMime(bytes: Uint8Array): 'image/png' | 'image/jpeg' | 'image/gif' | 'image/webp' | 'image/heic' | 'image/heif' | null {
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
    if (bytes.length < 16 || !startsWith(bytes, ascii('ftyp'), 4)) {
        return null;
    }

    const size = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(0);

    if (size < 16 || size > bytes.length || size % 4 !== 0) {
        return null;
    }

    const brands = [String.fromCharCode(...bytes.subarray(8, 12))];

    for (let offset = 16; offset < size; offset += 4) {
        brands.push(String.fromCharCode(...bytes.subarray(offset, offset + 4)));
    }

    if (brands.some((brand) => brand === 'avif' || brand === 'avis')) {
        return null;
    }

    if (brands.some((brand) => ['heic', 'heix', 'heim', 'heis', 'hevc', 'hevx', 'hevm', 'hevs'].includes(brand))) {
        return 'image/heic';
    }

    return brands.some((brand) => brand === 'mif1' || brand === 'msf1') ? 'image/heif' : null;
}

export const CHAT_IMAGE_REQUEST_SCHEMAS = {
    'chat.imageTarget': { payload: ChatImageTargetPayloadSchema, result: ChatImageTargetResultSchema },
    'chat.saveImage': { payload: ChatImageSavePayloadSchema, result: ChatImageSaveResultSchema }
} as const;
