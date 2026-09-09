import { describe, expect, test } from 'bun:test';
import { CHAT_ATTACHMENTS_MAX_COUNT, CHAT_ATTACHMENT_MAX_BYTES } from '@ruimte/contracts';
import { attachmentUrl, checkAttachmentLimits, isAttachmentMediaType } from './attachments';

const image = (name: string, bytes = 1000, mediaType = 'image/png') => ({ name, bytes, mediaType });

describe('checkAttachmentLimits', () => {
    test('accepts supported images under the size limit', () => {
        const { accepted, rejected } = checkAttachmentLimits(0, [image('a.png'), image('b.jpg', 10, 'image/jpeg')]);
        expect(accepted.map((entry) => entry.name)).toEqual(['a.png', 'b.jpg']);
        expect(rejected).toEqual([]);
    });

    test('rejects other types and oversized images with a reason', () => {
        const { accepted, rejected } = checkAttachmentLimits(0, [image('doc.pdf', 10, 'application/pdf'), image('big.png', CHAT_ATTACHMENT_MAX_BYTES + 1)]);
        expect(accepted).toEqual([]);
        expect(rejected.map((entry) => entry.name)).toEqual(['doc.pdf', 'big.png']);
        expect(rejected[1]!.reason).toContain('5 MB');
    });

    test('counts what the composer already holds against the maximum', () => {
        const { accepted, rejected } = checkAttachmentLimits(CHAT_ATTACHMENTS_MAX_COUNT - 1, [image('x.png'), image('y.png')]);
        expect(accepted.map((entry) => entry.name)).toEqual(['x.png']);
        expect(rejected[0]!.reason).toContain(String(CHAT_ATTACHMENTS_MAX_COUNT));
    });
});

test('media type guard and data url', () => {
    expect(isAttachmentMediaType('image/webp')).toBe(true);
    expect(isAttachmentMediaType('image/svg+xml')).toBe(false);
    expect(attachmentUrl({ name: 'a', mediaType: 'image/png', data: 'AAAA' })).toBe('data:image/png;base64,AAAA');
});
