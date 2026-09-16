import { describe, expect, test } from 'bun:test';
import { attachmentImageMime, CHAT_ATTACHMENTS_MAX_BYTES, ChatAttachmentUploadsSchema, ChatSendPayloadSchema } from './chat.ts';

describe('attachment images', () => {
    test.each([
        ['shot', 'IMAGE/PNG; charset=binary', 'image/png'],
        ['shot.JPG', 'application/octet-stream', 'image/jpeg'],
        ['shot.webp', '', 'image/webp'],
        ['shot.gif', 'image/gif', 'image/gif'],
        ['drawing.svg', 'image/svg+xml', null],
        ['photo.heic', 'image/heic', null],
        ['photo.png', 'application/pdf', null],
        ['png', '', null],
        ['file.constructor', 'application/octet-stream', null],
        ['unknown', 'application/octet-stream', null]
    ])('%s with %s is %s', (name, mime, expected) => {
        expect(attachmentImageMime({ name, mime })).toBe(expected);
    });
});

describe('attachment upload limits', () => {
    const upload = (bytes: number) => ({ name: 'shot.png', mime: 'image/png', data: Buffer.alloc(bytes).toString('base64') });

    test('accepts the exact byte budget and rejects one extra byte even when base64 has the same length', () => {
        const exact = upload(CHAT_ATTACHMENTS_MAX_BYTES);
        const over = upload(CHAT_ATTACHMENTS_MAX_BYTES + 1);
        expect(exact.data.length).toBe(over.data.length);
        expect(ChatAttachmentUploadsSchema.safeParse([exact]).success).toBe(true);
        expect(ChatAttachmentUploadsSchema.safeParse([over]).success).toBe(false);
        expect(ChatSendPayloadSchema.safeParse({ chatId: 'chat', text: '', attachments: [exact, upload(1)] }).success).toBe(false);
    });

    test.each(['', '???=', 'Y Q==', 'YQ=', 'Y===', 'YQ==AAAA'])('rejects malformed base64 %s', (data) => {
        expect(ChatAttachmentUploadsSchema.safeParse([{ name: 'bad.png', mime: 'image/png', data }]).success).toBe(false);
    });
});
