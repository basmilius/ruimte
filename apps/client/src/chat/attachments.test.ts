import { describe, expect, test } from 'bun:test';
import { CHAT_ATTACHMENTS_MAX_BYTES, CHAT_ATTACHMENTS_MAX_COUNT } from '@ruimte/contracts';
import { checkAttachmentLimits, fileBadge, formatBytes, isImageAttachment, uploadBytes } from './attachments';

const file = (name: string, mime: string, bytes: number) => ({ name, mime, bytes });

describe('checkAttachmentLimits', () => {
    test('takes any file type now, so a PDF and a zip go through', () => {
        const checked = checkAttachmentLimits(0, [file('paper.pdf', 'application/pdf', 10), file('bundle.zip', 'application/zip', 20)]);
        expect(checked.accepted.map((entry) => entry.name)).toEqual(['paper.pdf', 'bundle.zip']);
        expect(checked.rejected).toEqual([]);
    });

    test('refuses a file over the cap and says how big the cap is', () => {
        const checked = checkAttachmentLimits(0, [file('huge.mov', 'video/quicktime', 26 * 1024 * 1024)]);
        expect(checked.accepted).toEqual([]);
        expect(checked.rejected[0]).toEqual({ name: 'huge.mov', reason: 'Larger than 10 MB' });
    });

    test('counts what the composer already holds against the per-message limit', () => {
        const checked = checkAttachmentLimits(CHAT_ATTACHMENTS_MAX_COUNT, [file('one.png', 'image/png', 10)]);
        expect(checked.accepted).toEqual([]);
        expect(checked.rejected[0]?.reason).toBe(`At most ${CHAT_ATTACHMENTS_MAX_COUNT} files per message`);
    });

    test('counts existing files and this batch toward the byte budget without charging rejected files', () => {
        const checked = checkAttachmentLimits(
            1,
            [file('too-big.png', 'image/png', 7), file('fits.txt', 'text/plain', 4), file('last.png', 'image/png', 3)],
            CHAT_ATTACHMENTS_MAX_BYTES - 6
        );
        expect(checked.accepted.map((entry) => entry.name)).toEqual(['fits.txt']);
        expect(checked.rejected.map((entry) => entry.name)).toEqual(['too-big.png', 'last.png']);
        expect(checked.rejected[0]?.reason).toBe('Attachments must total at most 10 MB per message');
    });

    test('rejects empty files before reading them', () => {
        expect(checkAttachmentLimits(0, [file('empty.png', 'image/png', 0)]).rejected[0]?.reason).toBe('The file is empty');
    });
});

describe('isImageAttachment', () => {
    test('only an image mime draws as a thumbnail', () => {
        expect(isImageAttachment('image/webp')).toBe(true);
        expect(isImageAttachment('application/pdf')).toBe(false);
    });
});

describe('fileBadge', () => {
    test('reads the extension in capitals', () => {
        expect(fileBadge('ruimte-codebase-review.pdf')).toBe('PDF');
        expect(fileBadge('report.v2.html')).toBe('HTML');
    });

    test('has none for a dotfile, a trailing dot or no extension', () => {
        expect(fileBadge('.env')).toBeNull();
        expect(fileBadge('notes.')).toBeNull();
        expect(fileBadge('Makefile')).toBeNull();
    });

    test('has none for an extension too long to read as a type', () => {
        expect(fileBadge('backup.20260924')).toBeNull();
    });
});

describe('formatBytes', () => {
    test('reads as bytes, kilobytes or megabytes', () => {
        expect(formatBytes(512)).toBe('512 B');
        expect(formatBytes(2048)).toBe('2 KB');
        expect(formatBytes(1_500_000)).toBe('1.4 MB');
        expect(formatBytes(25 * 1024 * 1024)).toBe('25 MB');
    });
});

describe('uploadBytes', () => {
    test('answers what the base64 the composer holds weighs decoded', () => {
        expect(uploadBytes({ name: 'a.txt', mime: 'text/plain', data: Buffer.from('hello').toString('base64') })).toBe(5);
        expect(uploadBytes({ name: 'a.txt', mime: 'text/plain', data: Buffer.from('four').toString('base64') })).toBe(4);
    });
});
