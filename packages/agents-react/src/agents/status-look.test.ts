import { describe, expect, test } from 'bun:test';
import { statusLookOf, taskStatusWord, type StatusWord } from './status-look';

describe('how a state looks', () => {
    test('only running spins', () => {
        const words: StatusWord[] = ['running', 'paused', 'done', 'failed', 'cancelled'];
        expect(words.filter((word) => statusLookOf(word).spins)).toEqual(['running']);
    });

    test("a task's open state is the running one everything else draws, and paused while its child waits out a limit", () => {
        expect(taskStatusWord({ status: 'open' })).toBe('running');
        expect(taskStatusWord({ status: 'open', paused: { kind: 'usage', until: 1 } })).toBe('paused');
        expect(taskStatusWord({ status: 'cancelled' })).toBe('cancelled');
        // A task that settled after its pause says how it settled.
        expect(taskStatusWord({ status: 'done', paused: { kind: 'overload' } })).toBe('done');
    });
});
