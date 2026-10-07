import { describe, expect, test } from 'bun:test';
import { databaseTargetOf, databaseViewName } from './view-name.ts';

describe('what a database view is called', () => {
    test('the table, and the table with its structure', () => {
        expect(databaseViewName({ table: 'orders', mode: 'data' })).toBe('orders');
        expect(databaseViewName({ table: 'orders', mode: 'structure' })).toBe('orders (structure)');
    });

    test('a filter stays recognizable and short', () => {
        expect(databaseViewName({ table: 'orders', mode: 'data', where: "status = 'open'" })).toBe("orders (status = 'open')");
        expect(databaseViewName({ table: 'orders', mode: 'data', where: "status  =\n'open'" })).toBe("orders (status = 'open')");
        const long = databaseViewName({ table: 'orders', mode: 'data', where: "status = 'open' AND created_at > '2026-01-01' AND total > 100" });
        expect(long).toBe("orders (status = 'open' AND cre…)");
    });
});

describe('the view a loose tab becomes', () => {
    const base = { connectionId: 'shop', schema: 'shop' };

    test('a table keeps its filter and what the database said it is', () => {
        expect(databaseTargetOf({ kind: 'table', ...base, table: 'orders', where: 'id > 3', tableKind: 'view' })).toEqual({
            ...base,
            table: 'orders',
            mode: 'data',
            where: 'id > 3',
            tableKind: 'view'
        });
    });

    test('a structure has no filter, and a designer is no view', () => {
        expect(databaseTargetOf({ kind: 'structure', ...base, table: 'orders', where: 'id > 3' })).toEqual({ ...base, table: 'orders', mode: 'structure' });
        expect(databaseTargetOf({ kind: 'designer', ...base, table: 'orders' })).toBeNull();
        expect(databaseTargetOf({ kind: 'designer', ...base })).toBeNull();
    });
});
