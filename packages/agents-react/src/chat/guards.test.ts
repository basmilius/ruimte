import { describe, expect, test } from 'bun:test';
import {
    PASTE_ATTACHMENT_FROM_BYTES,
    PROMPT_COUNTER_FROM,
    PROMPT_MAX_CHARS,
    pasteBecomesAttachment,
    pastedTextName,
    promptGuard,
    usableSlashCommands
} from './guards.ts';

describe('promptGuard', () => {
    test('stays quiet until the prompt is long, and refuses past the cap', () => {
        expect(promptGuard('hello')).toEqual({ count: 5, visible: false, tooLong: false });
        expect(promptGuard('x'.repeat(PROMPT_COUNTER_FROM - 1)).visible).toBe(false);
        expect(promptGuard('x'.repeat(PROMPT_COUNTER_FROM)).visible).toBe(true);
        expect(promptGuard('x'.repeat(PROMPT_MAX_CHARS)).tooLong).toBe(false);
        expect(promptGuard('x'.repeat(PROMPT_MAX_CHARS + 1))).toMatchObject({ visible: true, tooLong: true });
    });
});

describe('usableSlashCommands', () => {
    test('drops what only the CLI terminal can do and keeps the rest, clear included', () => {
        expect(usableSlashCommands(['compact', 'clear', 'context', 'doctor', 'theme', 'security-review', 'vim'])).toEqual([
            'compact',
            'clear',
            'context',
            'security-review'
        ]);
        expect(usableSlashCommands([])).toEqual([]);
    });
});

describe('pasteBecomesAttachment', () => {
    test('31 KiB of text pastes inline and 32 KiB becomes an attachment', () => {
        expect(pasteBecomesAttachment('x'.repeat(31 * 1024))).toBe(false);
        expect(pasteBecomesAttachment('x'.repeat(PASTE_ATTACHMENT_FROM_BYTES - 1))).toBe(false);
        expect(pasteBecomesAttachment('x'.repeat(PASTE_ATTACHMENT_FROM_BYTES))).toBe(true);
        expect(pasteBecomesAttachment('x'.repeat(40 * 1024))).toBe(true);
    });

    test('counts bytes rather than characters', () => {
        // Three bytes each in UTF-8, so a third of the threshold in characters is already enough.
        expect(pasteBecomesAttachment('\u20ac'.repeat(Math.ceil(PASTE_ATTACHMENT_FROM_BYTES / 3)))).toBe(true);
        expect(pasteBecomesAttachment('\u20ac'.repeat(Math.floor(PASTE_ATTACHMENT_FROM_BYTES / 3) - 1))).toBe(false);
    });
});

describe('pastedTextName', () => {
    test('takes the first number no attachment of the draft has', () => {
        expect(pastedTextName([])).toBe('paste-1.txt');
        expect(pastedTextName(['paste-1.txt', 'shot.png', 'paste-3.txt'])).toBe('paste-2.txt');
    });
});
