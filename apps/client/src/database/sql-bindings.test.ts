import { describe, expect, test } from 'bun:test';
import type { DatabaseConnection, LanguageSqlChangedEvent, LanguageSqlState } from '@ruimte/contracts';
import { choiceOf, createSqlBindings, snapshotOf, startDatabaseOf } from './sql-bindings.ts';

const SHOP: DatabaseConnection = { id: 'shop', name: 'Shop', shared: true, config: { engine: 'mysql', host: 'db', user: 'app', database: 'shop' } };
const WIDE: DatabaseConnection = { id: 'wide', name: 'Wide', shared: false, config: { engine: 'mysql', host: 'db', user: 'root' } };
const LOCAL: DatabaseConnection = { id: 'local', name: 'Local', shared: false, config: { engine: 'sqlite', path: '/repo/local.sqlite' } };

/* Lets every pending promise run, without a timer. */
function drained(): Promise<void> {
    return new Promise((resolve) => setImmediate(resolve));
}

describe('what a .sql file reads', () => {
    const sql = {
        default: { connectionId: 'shop' },
        files: { 'a.sql': { connectionId: 'local' }, 'b.sql': { connectionId: null }, 'c.sql': { connectionId: 'wide', database: 'stats' } }
    };
    const connections = [SHOP, WIDE, LOCAL];

    test('follows the rules the machine applies', () => {
        expect(choiceOf(sql, connections, '/repo', '/repo/.ruimte/private/consoles/wide/Wide 1.sql', '.ruimte/private/consoles/wide/Wide 1.sql')).toEqual({
            source: 'console',
            connectionId: 'wide',
            database: null
        });
        expect(choiceOf(sql, connections, '/repo', '/repo/a.sql', 'a.sql')).toEqual({ source: 'file', connectionId: 'local', database: 'main' });
        expect(choiceOf(sql, connections, '/repo', '/repo/b.sql', 'b.sql')).toEqual({ source: 'unbound' });
        expect(choiceOf(sql, connections, '/repo', '/repo/c.sql', 'c.sql')).toEqual({ source: 'file', connectionId: 'wide', database: 'stats' });
        expect(choiceOf(sql, connections, '/repo', '/repo/d.sql', 'd.sql')).toEqual({ source: 'default', connectionId: 'shop', database: 'shop' });
        expect(choiceOf({}, connections, '/repo', '/repo/d.sql', 'd.sql')).toEqual({ source: 'none' });
    });

    test('the database a connection starts in, and the snapshot of a choice', () => {
        expect([SHOP, WIDE, LOCAL].map(startDatabaseOf)).toEqual(['shop', null, 'main']);
        const snapshot = { connectionId: 'wide', database: null, dialect: 'mysql', takenAt: '2026-10-07T09:00:00.000Z', tables: 2 };
        expect(snapshotOf([snapshot], 'wide', null)).toBe(snapshot);
        expect(snapshotOf([snapshot], 'wide', 'stats')).toBeNull();
    });
});

describe('the SQL choices of the project on screen', () => {
    function machine(state: LanguageSqlState) {
        const asked: { type: string; payload: unknown }[] = [];
        const listeners = new Set<(event: LanguageSqlChangedEvent) => void>();
        const transport = {
            request: async (type: string, payload: unknown): Promise<unknown> => {
                asked.push({ type, payload });
                if (type === 'language.sql.bind') {
                    return { ...state, sql: { files: { 'a.sql': (payload as { binding: unknown }).binding } } };
                }
                return state;
            },
            on: (_event: string, handler: (event: never) => void) => {
                listeners.add(handler as (event: LanguageSqlChangedEvent) => void);
                return () => listeners.delete(handler as (event: LanguageSqlChangedEvent) => void);
            },
            subscribeStatus: () => () => undefined
        };
        return { transport: transport as never, asked, emit: (event: LanguageSqlChangedEvent) => listeners.forEach((listener) => listener(event)) };
    }

    test('reads them, takes what the machine says changed, and sends a choice and a refresh', async () => {
        const fake = machine({ sql: { default: { connectionId: 'shop' } }, snapshots: [] });
        const notes: string[] = [];
        const model = createSqlBindings({ notify: (title) => notes.push(title) });
        model.attach({ endpointId: 'local', projectId: 'p', folder: '/repo', transport: fake.transport });
        await drained();
        expect(model.store.getState().sql).toEqual({ default: { connectionId: 'shop' } });
        fake.emit({ projectId: 'other', sql: {}, snapshots: [] });
        expect(model.store.getState().sql).toEqual({ default: { connectionId: 'shop' } });
        fake.emit({ projectId: 'p', sql: {}, snapshots: [] });
        expect(model.store.getState().sql).toEqual({});
        await model.bind('/repo/a.sql', { connectionId: null });
        expect(fake.asked.at(-1)).toEqual({ type: 'language.sql.bind', payload: { projectId: 'p', path: '/repo/a.sql', binding: { connectionId: null } } });
        expect(model.store.getState().sql).toEqual({ files: { 'a.sql': { connectionId: null } } });
        await model.refresh('shop', 'orders');
        expect(fake.asked.at(-1)).toEqual({ type: 'database.snapshot.refresh', payload: { projectId: 'p', connectionId: 'shop', schema: 'orders' } });
        expect(notes).toEqual([]);
        model.attach(null);
        expect(model.store.getState()).toEqual({ key: null, sql: {}, snapshots: [] });
    });
});
