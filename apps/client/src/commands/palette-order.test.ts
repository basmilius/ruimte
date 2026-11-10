import { describe, expect, test } from 'bun:test';
import { behaviorOf } from '@/commands/behavior';
import { PALETTE_ORDER } from '@/commands/palette-order';
import { commandRows } from '@/commands/palette-rows';
import { commandIds, commandSpec, isCommandId } from '@/commands/registry';

const ordered = PALETTE_ORDER.filter((entry): entry is string => typeof entry === 'string');

describe('the order of the palette', () => {
    test('places every row of the table the palette offers', () => {
        const missing = commandIds().filter((id) => commandSpec(id).palette && behaviorOf(id) !== undefined && !ordered.includes(id));

        expect(missing).toEqual([]);
    });

    test('names only rows of the table, each once', () => {
        expect(ordered.filter((id) => !isCommandId(id))).toEqual([]);
        expect(new Set(ordered).size).toBe(ordered.length);
    });

    test('gives the rows in its own order, not in the order the features registered them', () => {
        const rows = commandRows().map((row) => row.id);
        const placed = rows.filter((id) => ordered.includes(id));

        expect(placed).toEqual(ordered.filter((id) => placed.includes(id)));
        expect(placed.indexOf('open-folder')).toBeLessThan(placed.indexOf('settings'));
    });
});
