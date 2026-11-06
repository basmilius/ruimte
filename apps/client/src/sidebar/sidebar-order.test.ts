import { describe, expect, test } from 'bun:test';
import { foldedProjects, moveInOrder, movableKeys, placeSeparators, separatorKey } from './sidebar-projects';

describe('moveInOrder', () => {
    test('moves a project among the ones on screen', () => {
        expect(moveInOrder(['a', 'b', 'c'], ['a', 'b', 'c'], 'c', 0)).toEqual(['c', 'a', 'b']);
        expect(moveInOrder(['a', 'b', 'c'], ['a', 'b', 'c'], 'a', 2)).toEqual(['b', 'c', 'a']);
        expect(moveInOrder(['a', 'b', 'c'], ['a', 'b', 'c'], 'b', 1)).toEqual(['a', 'b', 'c']);
    });

    test('keeps the place of a project that is closed, so it comes back there', () => {
        // `x` is closed: it stays between `a` and `b` whatever moves around it.
        expect(moveInOrder(['a', 'x', 'b', 'c'], ['a', 'b', 'c'], 'c', 1)).toEqual(['a', 'x', 'c', 'b']);
        expect(moveInOrder(['a', 'x', 'b', 'c'], ['a', 'b', 'c'], 'a', 2)).toEqual(['x', 'b', 'c', 'a']);
    });

    test('clamps a place past either end', () => {
        expect(moveInOrder(['a', 'b'], ['a', 'b'], 'a', 9)).toEqual(['b', 'a']);
        expect(moveInOrder(['a', 'b'], ['a', 'b'], 'b', -3)).toEqual(['b', 'a']);
    });
});

describe('placeSeparators', () => {
    const line = { id: 'line', label: '', folded: false };
    const work = { id: 'work', label: 'Work', folded: false };

    test('puts a separator before the next project on screen', () => {
        const places = placeSeparators(['a', separatorKey('work'), 'b'], ['a', 'b'], [work]);
        expect(places).toEqual({ before: { b: [work] }, trailing: [] });
        expect(movableKeys(['a', 'b'], places)).toEqual(['a', separatorKey('work'), 'b']);
    });

    test('a separator over a closed project stays over the next one that is open', () => {
        const places = placeSeparators([separatorKey('line'), 'x', 'a'], ['a'], [line]);
        expect(places.before).toEqual({ a: [line] });
    });

    test('a separator after the last project trails, and one that is gone shows nowhere', () => {
        const places = placeSeparators(['a', separatorKey('gone'), separatorKey('line')], ['a'], [line]);
        expect(places).toEqual({ before: {}, trailing: [line] });
        expect(movableKeys(['a'], places)).toEqual(['a', separatorKey('line')]);
    });

    test('moves among projects like a project does', () => {
        const visible = ['a', separatorKey('line'), 'b'];
        expect(moveInOrder(visible, visible, separatorKey('line'), 0)).toEqual([separatorKey('line'), 'a', 'b']);
    });
});

describe('foldedProjects', () => {
    test('a folded heading hides the projects up to the next separator', () => {
        const separators = [
            { id: 'work', label: 'Work', folded: true },
            { id: 'line', label: '', folded: false }
        ];
        const movable = ['a', separatorKey('work'), 'b', 'c', separatorKey('line'), 'd'];
        expect([...foldedProjects(movable, separators)]).toEqual(['b', 'c']);
    });

    test('a bare line hides nothing, whatever it says it is', () => {
        expect(foldedProjects([separatorKey('line'), 'a'], [{ id: 'line', label: '', folded: true }]).size).toBe(0);
    });
});
