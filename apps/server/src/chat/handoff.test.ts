import { describe, expect, test } from 'bun:test';
import type { ChatItem } from '@ruimte/contracts';
import { handoffText, type HandoffMeta } from './handoff.ts';

const meta: HandoffMeta = {
    fromName: 'Claude Code',
    originalId: 'chat-lead',
    originalTitle: 'Lexer',
    view: false,
    turnNumber: 6,
    totalTurns: 6,
    at: Date.UTC(2026, 8, 16, 14, 2),
    cwd: '/work/lexer',
    worktree: null
};

/* Six turns, each a question and an answer of `size` characters. */
const sixTurns = (size: number): ChatItem[] =>
    Array.from({ length: 6 }, (_, index): ChatItem[] => {
        const turnId = `turn-${index + 1}`;
        return [
            { id: turnId, kind: 'turn', createdAt: index, turnId, state: 'done', endedAt: index, costUsd: 0 },
            { id: `user-${index + 1}`, kind: 'user', createdAt: index, turnId, text: `question ${index + 1}` },
            { id: `answer-${index + 1}`, kind: 'assistant', createdAt: index, turnId, text: `answer ${index + 1} ${'x'.repeat(size)}`, streaming: false }
        ];
    }).flat();

describe('handoffText', () => {
    test('a short conversation goes along whole, under a header that says where it came from and how to read it', () => {
        const { text, turns, all } = handoffText(sixTurns(10), meta);
        expect([turns, all]).toEqual([6, true]);
        expect(text).toStartWith(
            'Ruimte: you take over a conversation that ran with Claude Code in node chat-lead ("Lexer") on this machine, forked after its turn 6 of 6 on 2026-09-16 14:02 UTC.'
        );
        expect(text).toContain('ruimte-context read chat-lead');
        expect(text).toContain('What follows is all of it, as text.');
        expect(text.indexOf('question 1')).toBeLessThan(text.indexOf('question 6'));
        expect(text).toEndWith("Continue from here. The person's next message follows.");
    });

    test('a long one keeps only its last whole turns within the budget, and always the last', () => {
        const long = handoffText(sixTurns(4000), meta);
        expect(long.turns).toBe(3);
        expect(long.all).toBe(false);
        expect(long.text).toContain('What follows is its last 3 turns, as text.');
        expect(long.text).not.toContain('question 3');
        expect(long.text).toContain('question 4');
        const tiny = handoffText(sixTurns(4000), meta, 1);
        expect(tiny.turns).toBe(1);
        expect(tiny.text).toContain('question 6');
        expect(tiny.text).toContain('its last turn, as text');
    });

    test('a worktree is named with where its files start, and the text has no long dashes', () => {
        const { text } = handoffText(sixTurns(10), { ...meta, view: true, worktree: { branch: 'lexer-fork', afterTurn: true } });
        expect(text).toContain('in view chat-lead');
        expect(text).toContain('Folder: /work/lexer (a git worktree on branch lexer-fork, with the files as they were after that turn).');
        expect(text).not.toMatch(/[–—]/);
    });
});
