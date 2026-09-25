import { describe, expect, test } from 'bun:test';
import { isTerminalReply } from './terminal-replies.ts';

describe('isTerminalReply', () => {
    test('recognizes what an emulator answers by itself', () => {
        expect(isTerminalReply('\x1b[?1;2c')).toBe(true);
        expect(isTerminalReply('\x1b[>0;276;0c')).toBe(true);
        expect(isTerminalReply('\x1b[24;80R')).toBe(true);
        expect(isTerminalReply('\x1b[0n')).toBe(true);
        expect(isTerminalReply('\x1b[?2004;2$y')).toBe(true);
        expect(isTerminalReply('\x1b[8;24;80t')).toBe(true);
        expect(isTerminalReply('\x1b]11;rgb:1c1c/1c1c/1e1e\x1b\\')).toBe(true);
        expect(isTerminalReply('\x1b]10;rgb:e8e8/e8e8/eaea\x07')).toBe(true);
        expect(isTerminalReply('\x1bP1$r0m\x1b\\')).toBe(true);
        expect(isTerminalReply('\x1b[I')).toBe(true);
        expect(isTerminalReply('\x1b[?1;2c\x1b[24;80R')).toBe(true);
    });

    test('leaves what a person types', () => {
        expect(isTerminalReply('a')).toBe(false);
        expect(isTerminalReply('\r')).toBe(false);
        expect(isTerminalReply('\x1b[A')).toBe(false);
        expect(isTerminalReply('\x1b[15~')).toBe(false);
        expect(isTerminalReply('\x1b[<0;10;5M')).toBe(false);
        expect(isTerminalReply('\x1b[200~pasted\x1b[201~')).toBe(false);
        expect(isTerminalReply('\x1b[?1;2cx')).toBe(false);
        expect(isTerminalReply('')).toBe(false);
    });
});
