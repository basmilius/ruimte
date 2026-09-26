import { describe, expect, test } from 'bun:test';
import type { ChatItem, ChatTurnItem } from '@ruimte/agent-contracts';
import { limitedTurn, limitResumeAt } from './limit-resume.ts';

const turn = (id: string, limit?: ChatTurnItem['limit']): ChatTurnItem => ({
    id,
    kind: 'turn',
    createdAt: 1,
    turnId: id,
    state: limit ? 'error' : 'done',
    endedAt: 2,
    costUsd: 0,
    ...(limit ? { limit } : {})
});

const NOW = 1_000_000;

describe('limitResumeAt', () => {
    test('an overload is tried again after 1, 5 and 15 minutes, and after that not at all', () => {
        const items: ChatItem[] = [turn('t0')];
        const delays: Array<number | null> = [];
        for (let i = 1; i <= 4; i++) {
            const limited = turn(`t${i}`, { kind: 'overload' });
            items.push(limited);
            const at = limitResumeAt(items, limited, NOW);
            delays.push(at === null ? null : at - NOW);
        }
        expect(delays).toEqual([60_000, 300_000, 900_000, null]);
    });

    test('a usage limit waits for its reset, and one without a reset is never taken up', () => {
        const limited = turn('t1', { kind: 'usage', resetsAt: NOW + 3_600_000 });
        expect(limitResumeAt([turn('t0'), limited], limited, NOW)).toBe(NOW + 3_600_000);
        const unknown = turn('t2', { kind: 'usage' });
        expect(limitResumeAt([unknown], unknown, NOW)).toBeNull();
    });

    test('a usage limit that held past its reset waits at least the next delay', () => {
        const first = turn('t1', { kind: 'usage', resetsAt: NOW - 1_000 });
        const again = turn('t2', { kind: 'usage', resetsAt: NOW - 1_000 });
        expect(limitResumeAt([first, again], again, NOW)).toBe(NOW + 300_000);
    });

    test('a turn a person got in between starts the count again', () => {
        const items = [turn('t1', { kind: 'overload' }), turn('t2', { kind: 'overload' }), turn('t3'), turn('t4', { kind: 'overload' })];
        expect(limitResumeAt(items, items[3] as ChatTurnItem, NOW)).toBe(NOW + 60_000);
        expect(limitedTurn(items)?.id).toBe('t4');
        expect(limitedTurn(items.slice(0, 3))).toBeNull();
    });
});
