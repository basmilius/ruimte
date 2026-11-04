import { afterEach, describe, expect, test } from 'bun:test';
import { MAX_TERMINAL_READ_LINES } from '@ruimte/actions';
import type { Terminal } from '@xterm/xterm';
import { forgetScreen, lastScreenOf, registerTerminal, screenOf } from './registry';

afterEach(() => {
    forgetScreen('machine', 'long');
    forgetScreen('machine', 'short');
});

/* A terminal with `written` lines of output in its buffer, under the rows of its screen left empty below the last one. */
function terminalWith(written: number, rows: number): Terminal {
    const lines = [...Array.from({ length: written }, (_, index) => `line ${index}`), '', ''];

    return {
        rows,
        buffer: { active: { length: lines.length, getLine: (index: number) => ({ translateToString: () => lines[index] }) } }
    } as unknown as Terminal;
}

describe('a terminal out of sight', () => {
    test('keeps only the lines a read may ask for, and its plate shows the rows it showed', () => {
        const unmount = registerTerminal('machine', 'long', terminalWith(5000, 24));

        expect(screenOf('machine', 'long')).toHaveLength(5000);

        unmount();

        const kept = screenOf('machine', 'long')!;

        expect(kept).toHaveLength(MAX_TERMINAL_READ_LINES);
        expect(kept.at(-1)).toBe('line 4999');
        expect(lastScreenOf('machine', 'long')).toEqual(Array.from({ length: 24 }, (_, index) => `line ${4976 + index}`));
    });

    test('with less output than its screen keeps all of it', () => {
        registerTerminal('machine', 'short', terminalWith(3, 24))();

        expect(screenOf('machine', 'short')).toEqual(['line 0', 'line 1', 'line 2']);
        expect(lastScreenOf('machine', 'short')).toEqual(['line 0', 'line 1', 'line 2']);
    });
});
