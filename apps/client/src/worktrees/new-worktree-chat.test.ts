import { describe, expect, test } from 'bun:test';
import { branchFromTitle, proposedBranch } from './new-worktree-chat';

describe('branchFromTitle', () => {
    test('keeps what a ref takes and falls back to work', () => {
        expect(branchFromTitle('Fix the Login Bug!')).toBe('fix-the-login-bug');
        expect(branchFromTitle('feature/x')).toBe('feature/x');
        expect(branchFromTitle('???')).toBe('work');
    });
});

describe('proposedBranch', () => {
    test('skips a name that is taken', () => {
        const values = [0, 0.5];
        expect(proposedBranch(['chat-0000'], () => values.shift() ?? 0)).toBe('chat-i000');
    });
});
