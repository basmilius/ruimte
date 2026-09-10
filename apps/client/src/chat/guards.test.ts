import { describe, expect, test } from 'bun:test';
import { PROMPT_COUNTER_FROM, PROMPT_MAX_CHARS, promptGuard, usableSlashCommands } from './guards.ts';

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
    test('drops what only the CLI terminal can do and keeps the rest', () => {
        expect(usableSlashCommands(['compact', 'clear', 'context', 'doctor', 'theme', 'security-review', 'vim'])).toEqual([
            'compact',
            'context',
            'security-review'
        ]);
        expect(usableSlashCommands([])).toEqual([]);
    });
});
