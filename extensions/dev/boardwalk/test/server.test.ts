import { describe, expect, test } from 'bun:test';
import { createTestServer } from '@ruimte/extension/testing';
import type { BoardwalkServer } from '../server';

describe('Boardwalk on the machine', () => {
    test('lists the boards of the account, and answers the first one unless a board is named', async () => {
        const server = await createTestServer<BoardwalkServer>();
        const first = await server.call('board');
        const launch = await server.call('board', 'launch');

        expect(await server.call('boards')).toEqual({
            ok: true,
            value: [
                { id: 'sprint-12', name: 'Sprint 12', cards: 4 },
                { id: 'launch', name: 'Launch', cards: 2 }
            ]
        });
        expect(first.ok && first.value.name).toBe('Sprint 12');
        expect(launch.ok && launch.value.cards.map((card) => card.title)).toEqual(['Write the announcement', 'Record the walkthrough']);
        expect(await server.call('board', 'gone')).toEqual({ ok: false, error: { code: 'failed', message: 'Boardwalk has no board gone' } });
    });

    test('gives an agent a card along a line, also one stored before cards had columns', async () => {
        const server = await createTestServer<BoardwalkServer>();

        expect(await server.nodeContext('card', { title: 'Ship the import', column: 'Doing', points: 3 })).toEqual([
            { text: 'Card: Ship the import (Doing, 3 points)' }
        ]);
        expect(await server.nodeContext('card', 'Written before columns')).toEqual([{ text: 'Card: Written before columns' }]);
    });
});
