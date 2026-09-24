import { describe, expect, test } from 'bun:test';
import { flagOf, liveFlags, withFlags } from './project-flags.ts';
import type { ProjectView } from './project.ts';

describe('flags', () => {
    test('a color this version cannot paint reads as no flag', () => {
        expect(flagOf({ a: 'red', b: 'ultraviolet' }, 'a')).toBe('red');
        expect(flagOf({ a: 'red', b: 'ultraviolet' }, 'b')).toBeNull();
        expect(flagOf(undefined, 'a')).toBeNull();
    });

    test('setting or clearing what is already there changes nothing', () => {
        expect(withFlags({ a: 'red' }, ['a'], 'red')).toBeNull();
        expect(withFlags({}, ['a'], null)).toBeNull();
        expect(withFlags({ a: 'red' }, ['a', 'b'], 'blue')).toEqual({ a: 'blue', b: 'blue' });
        expect(withFlags({ a: 'red', b: 'blue' }, ['a'], null)).toEqual({ b: 'blue' });
    });

    test('only the flags of views and nodes still in the project stay', () => {
        const views: ProjectView[] = [
            {
                kind: 'canvas',
                id: 'main',
                name: 'Main',
                nodes: [{ id: 'n1', kind: 'note', title: 'n', x: 0, y: 0, w: 1, h: 1 }],
                texts: [],
                edges: [],
                layouts: []
            },
            { kind: 'chat', id: 'c1', name: 'Chat', node: {} }
        ];
        expect(liveFlags({ main: 'red', n1: 'blue', c1: 'green', gone: 'pink' }, views)).toEqual({ main: 'red', n1: 'blue', c1: 'green' });
    });
});
