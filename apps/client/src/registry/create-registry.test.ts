import { describe, expect, test } from 'bun:test';
import { createRegistry } from './create-registry';

interface Item {
    readonly id: string;
    readonly label: string;
}

describe('createRegistry', () => {
    test('keeps the order of registration', () => {
        const registry = createRegistry<Item>('thing', false);
        registry.add({ id: 'b', label: 'B' }, { id: 'a', label: 'A' });

        expect(registry.all().map((item) => item.id)).toEqual(['b', 'a']);
    });

    test('an id twice is a wiring mistake', () => {
        const registry = createRegistry<Item>('thing', false);
        registry.add({ id: 'a', label: 'A' });

        expect(() => registry.add({ id: 'a', label: 'Again' })).toThrow('The thing "a" is registered twice.');
        expect(registry.all()).toEqual([{ id: 'a', label: 'A' }]);
    });

    test('under a dev server that replaces modules an id twice takes the place of the first', () => {
        const registry = createRegistry<Item>('thing', true);
        registry.add({ id: 'a', label: 'A' }, { id: 'b', label: 'B' });
        registry.add({ id: 'b', label: 'B2' }, { id: 'c', label: 'C' });

        expect(registry.all()).toEqual([
            { id: 'a', label: 'A' },
            { id: 'b', label: 'B2' },
            { id: 'c', label: 'C' }
        ]);
        expect(registry.find('b')?.label).toBe('B2');
    });
});
