import { expect, test } from 'bun:test';
import { shellCommandLine, TerminalPrepareSourceSchema } from './terminal-prepare.ts';

test('keeps exact text, except the fence newline, and never strips a dangerous control', () => {
    expect(shellCommandLine('  echo "hello"  \n')).toBe('  echo "hello"  ');
    for (const code of ['', ' \n', 'echo one\necho two', 'echo ok\r', 'echo\tok', '\x1b[201~echo nope', 'echo\u202eabc', 'echo\u200babc', 'a'.repeat(1001)]) {
        expect(shellCommandLine(code)).toBeNull();
    }
    expect(TerminalPrepareSourceSchema.safeParse({ chatId: 'chat', itemId: 'item', language: 'shell', code: 'echo ok' }).success).toBe(false);
});
