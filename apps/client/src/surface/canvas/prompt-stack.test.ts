import { expect, test } from 'bun:test';
import { registerPromptStack, usePromptStacks } from './prompt-stack';

test('an old stack cleanup cannot erase its replacement or another canvas', () => {
    const old = registerPromptStack('main');
    const replacement = registerPromptStack('main');
    const other = registerPromptStack('other');

    try {
        old();
        expect(usePromptStacks.getState().byView.has('main')).toBe(true);
        replacement();
        expect(usePromptStacks.getState().byView.has('main')).toBe(false);
        expect(usePromptStacks.getState().byView.has('other')).toBe(true);
    } finally {
        old();
        replacement();
        other();
    }

    expect(usePromptStacks.getState().byView.has('other')).toBe(false);
});
