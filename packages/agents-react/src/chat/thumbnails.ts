import i18next from 'i18next';
import { useEffect, useState } from 'react';
import type { ChatAttachmentUpload } from '@ruimte/agent-contracts';
import { uploadPreviewUrl } from './attachments';

/* The edge of a composer thumbnail: a few times the 56 px it is drawn at, so a sharp screen still gets a sharp one. */
export const THUMBNAIL_PX = 256;

export interface ThumbnailCrop {
    sx: number;
    sy: number;
    /* The edge of the square taken from the middle of the image. */
    size: number;
    /* The edge the square is drawn at, never larger than it was. */
    out: number;
}

/* The square in the middle of an image that a thumbnail shows, the same part `object-cover` would. */
export const thumbnailCrop = (width: number, height: number, max: number = THUMBNAIL_PX): ThumbnailCrop => {
    const size = Math.max(1, Math.min(width, height));
    return {
        sx: Math.max(0, Math.floor((width - size) / 2)),
        sy: Math.max(0, Math.floor((height - size) / 2)),
        size,
        out: Math.min(max, size)
    };
};

const bytesOf = (base64: string): Uint8Array<ArrayBuffer> => {
    const binary = atob(base64);
    const bytes = new Uint8Array(new ArrayBuffer(binary.length));
    for (let i = 0; i < binary.length; i++) {
        bytes[i] = binary.charCodeAt(i);
    }
    return bytes;
};

const dataUrlOf = (blob: Blob): Promise<string> =>
    new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onerror = () => reject(reader.error ?? new Error(i18next.t('agent-chat:attachments.unreadableThumbnail')));
        reader.onload = () => resolve(String(reader.result));
        reader.readAsDataURL(blob);
    });

/*
 * A still of the middle of an image, decoded once. The composer used to draw the full data URL in a
 * 56 px box, which a browser decodes again for every paint, so a tall screenshot made typing stutter.
 * An animated image gives its first frame. Whatever cannot be decoded this way (an SVG, a browser
 * without `OffscreenCanvas`) falls back to the image itself, which is what it was before.
 */
const makeThumbnail = async (upload: ChatAttachmentUpload): Promise<string> => {
    try {
        const bitmap = await createImageBitmap(new Blob([bytesOf(upload.data)], { type: upload.mime }));
        const crop = thumbnailCrop(bitmap.width, bitmap.height);
        const canvas = new OffscreenCanvas(crop.out, crop.out);
        const context = canvas.getContext('2d');
        if (!context) {
            bitmap.close();
            return uploadPreviewUrl(upload);
        }
        context.drawImage(bitmap, crop.sx, crop.sy, crop.size, crop.size, 0, 0, crop.out, crop.out);
        bitmap.close();
        return await dataUrlOf(await canvas.convertToBlob({ type: 'image/png' }));
    } catch {
        return uploadPreviewUrl(upload);
    }
};

// Keyed by the upload itself, so a composer that mounts again finds it and a removed file lets it go.
const made = new WeakMap<ChatAttachmentUpload, string>();
const making = new WeakMap<ChatAttachmentUpload, Promise<string>>();

const thumbnailOf = (upload: ChatAttachmentUpload): Promise<string> => {
    let promise = making.get(upload);
    if (!promise) {
        promise = makeThumbnail(upload).then((url) => {
            made.set(upload, url);
            return url;
        });
        making.set(upload, promise);
    }
    return promise;
};

/* The thumbnail of an image the composer holds, or null while it is being made. */
export const useUploadThumbnail = (upload: ChatAttachmentUpload): string | null => {
    const [ready, setReady] = useState<{ upload: ChatAttachmentUpload; url: string } | null>(null);
    const cached = made.get(upload);

    useEffect(() => {
        if (made.has(upload)) {
            return;
        }
        let cancelled = false;
        void thumbnailOf(upload).then((url) => {
            if (!cancelled) {
                setReady({ upload, url });
            }
        });
        return () => {
            cancelled = true;
        };
    }, [upload]);

    return cached ?? (ready?.upload === upload ? ready.url : null);
};
