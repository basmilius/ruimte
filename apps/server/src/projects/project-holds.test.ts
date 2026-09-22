import { describe, expect, test } from 'bun:test';
import { ProjectHolds } from './project-holds.ts';

describe('ProjectHolds', () => {
    test('a hold is only the last one when nobody else has the project', () => {
        const holds = new ProjectHolds();
        holds.add('c1', 'p1');
        holds.add('c2', 'p1');

        expect(holds.remove('c1', 'p1')).toBe(false);
        expect(holds.remove('c2', 'p1')).toBe(true);
    });

    test('a client holding the same project twice holds it once', () => {
        const holds = new ProjectHolds();
        holds.add('c1', 'p1');
        holds.add('c1', 'p1');

        expect(holds.holders('p1')).toBe(1);
        expect(holds.remove('c1', 'p1')).toBe(true);
    });

    test('a socket that goes names the projects nobody holds any more', () => {
        const holds = new ProjectHolds();
        holds.add('c1', 'p1');
        holds.add('c1', 'p2');
        holds.add('c2', 'p2');

        expect(holds.dropClient('c1')).toEqual(['p1']);
        expect(holds.holders('p2')).toBe(1);
    });

    test('everyone but the client asking, which is what decides whether closing ends anything', () => {
        const holds = new ProjectHolds();
        holds.add('c1', 'p1');
        expect(holds.others('c1', 'p1')).toBe(0);

        holds.add('c2', 'p1');
        expect(holds.others('c1', 'p1')).toBe(1);
        expect(holds.others('c3', 'p1')).toBe(2);
    });

    test('a project a client never held, and a client nothing knows', () => {
        const holds = new ProjectHolds();
        expect(holds.remove('c1', 'p1')).toBe(true);
        expect(holds.dropClient('c1')).toEqual([]);
        expect(holds.has('c1', 'p1')).toBe(false);
    });
});
