import { describe, expect, test } from 'bun:test';
import { THUMBNAIL_PX, thumbnailCrop } from '@/chat/thumbnails';

describe('thumbnailCrop', () => {
    test('a very tall image gives the square in its middle, drawn at the thumbnail size', () => {
        expect(thumbnailCrop(2304, 32766)).toEqual({ sx: 0, sy: 15231, size: 2304, out: THUMBNAIL_PX });
    });

    test('a wide image is cropped from the sides', () => {
        expect(thumbnailCrop(1000, 400)).toEqual({ sx: 300, sy: 0, size: 400, out: THUMBNAIL_PX });
    });

    test('an image smaller than a thumbnail is never scaled up', () => {
        expect(thumbnailCrop(40, 90)).toEqual({ sx: 0, sy: 25, size: 40, out: 40 });
    });

    test('an image without a size still gives a square of one pixel', () => {
        expect(thumbnailCrop(0, 0)).toEqual({ sx: 0, sy: 0, size: 1, out: 1 });
    });
});
