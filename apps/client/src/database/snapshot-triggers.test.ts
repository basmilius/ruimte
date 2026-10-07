import { describe, expect, test } from 'bun:test';
import type { DatabaseConnection } from '@ruimte/contracts';
import { snapshotTrigger } from './snapshot-triggers.ts';

const SHOP: DatabaseConnection = { id: 'shop', name: 'Shop', shared: true, config: { engine: 'mysql', host: 'db', user: 'app' } };
const OTHER: DatabaseConnection = { id: 'other', name: 'Other', shared: true, config: { engine: 'mysql', host: 'elsewhere', user: 'app' } };

describe('when the machine takes a snapshot again', () => {
    test('a tree that reads the schemas of a session has its connection taken again, once at a time', async () => {
        const asked: string[] = [];
        let finish = (): void => undefined;
        const observe = snapshotTrigger(
            () => [SHOP, OTHER],
            (connectionId) => {
                asked.push(connectionId);
                return new Promise<void>((resolve) => {
                    finish = resolve;
                });
            }
        );
        observe({
            request: { method: 'open', params: { connection: { ...SHOP.config, password: 'hunter2' } } },
            response: { ok: true, result: { session: 's1', server: { flavor: 'mariadb', version: '11' } } }
        });
        observe({ request: { method: 'tables', params: { session: 's1', schema: 'shop' } }, response: { ok: true, result: { tables: [] } } });
        expect(asked).toEqual([]);
        observe({ request: { method: 'schemas', params: { session: 's1' } }, response: { ok: true, result: { schemas: [] } } });
        observe({ request: { method: 'schemas', params: { session: 's1' } }, response: { ok: true, result: { schemas: [] } } });
        expect(asked).toEqual(['shop']);
        finish();
        await new Promise((resolve) => setImmediate(resolve));
        observe({ request: { method: 'schemas', params: { session: 's1' } }, response: { ok: true, result: { schemas: [] } } });
        expect(asked).toEqual(['shop', 'shop']);
    });

    test('a session it did not see open, a closed one and a failed answer ask for nothing', () => {
        const asked: string[] = [];
        const observe = snapshotTrigger(
            () => [SHOP],
            async (connectionId) => {
                asked.push(connectionId);
            }
        );
        observe({ request: { method: 'schemas', params: { session: 'unknown' } }, response: { ok: true, result: { schemas: [] } } });
        observe({ request: { method: 'open', params: { connection: SHOP.config } }, response: { ok: false } });
        observe({ request: { method: 'open', params: { connection: SHOP.config } }, response: { ok: true, result: { session: 's2' } } });
        observe({ request: { method: 'close', params: { session: 's2' } }, response: { ok: true, result: null } });
        observe({ request: { method: 'schemas', params: { session: 's2' } }, response: { ok: true, result: { schemas: [] } } });
        expect(asked).toEqual([]);
    });
});
