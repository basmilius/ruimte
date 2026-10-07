import { describe, expect, test } from 'bun:test';
import type { DatabaseConnection, ProjectView } from '@ruimte/contracts';
import { databaseViewShareRefusal } from './view-sharing.ts';

const connection = (id: string, shared: boolean): DatabaseConnection =>
    ({ id, name: id, shared, config: { engine: 'sqlite', path: 'shop.db' } }) as unknown as DatabaseConnection;

const ORDERS = { kind: 'database', id: 'orders', name: 'orders', connectionId: 'shop', schema: 'main', table: 'orders', mode: 'data' } as ProjectView;

describe('sharing a database view', () => {
    test('waits for the connection to be shared, since the view only names it', () => {
        expect(databaseViewShareRefusal(ORDERS, [connection('shop', false)])).toBe('private-connection');
        expect(databaseViewShareRefusal(ORDERS, [connection('shop', true)])).toBeNull();
    });

    test('is refused when this machine has no such connection at all', () => {
        expect(databaseViewShareRefusal(ORDERS, [])).toBe('private-connection');
        expect(databaseViewShareRefusal(ORDERS, [connection('other', true)])).toBe('private-connection');
    });

    test('holds no other kind of view back', () => {
        expect(databaseViewShareRefusal({ kind: 'drawing', id: 'd', name: 'd' } as ProjectView, [])).toBeNull();
    });
});
