import { describe, expect, test } from 'bun:test';
import type { DatabaseConnection } from './database.ts';
import { choiceFor, consoleConnectionOf, consoleFolderOf, consolesFolderOf, designFolderOf, isRuimteState, startDatabaseOf } from './ruimte-folder.ts';

const SHOP: DatabaseConnection = { id: 'shop', name: 'Shop', shared: true, config: { engine: 'mysql', host: 'db', user: 'app', database: 'shop' } };
const WIDE: DatabaseConnection = { id: 'wide', name: 'Wide', shared: false, config: { engine: 'mysql', host: 'db', user: 'root' } };
const LOCAL: DatabaseConnection = { id: 'local', name: 'Local', shared: false, config: { engine: 'sqlite', path: '/repo/local.sqlite' } };

describe('the folders of a project', () => {
    test('a design lives under the private designs until it is shared, and a path with a slash stays put', () => {
        expect(designFolderOf({ path: 'onboarding' }, false)).toBe('.ruimte/private/designs/onboarding');
        expect(designFolderOf({ path: 'onboarding' }, true)).toBe('.ruimte/designs/onboarding');
        expect(designFolderOf({ path: 'designs/onboarding' }, false)).toBe('designs/onboarding');
    });

    test('Ruimte state is closed to file requests, except the files in the consoles and the designs', () => {
        expect(isRuimteState(['.ruimte'])).toBe(true);
        expect(isRuimteState(['.ruimte', 'project.json'])).toBe(true);
        expect(isRuimteState(['.ruimte', 'private', 'project.json'])).toBe(true);
        expect(isRuimteState(['.ruimte', 'drawings', 'a.json'])).toBe(true);
        expect(isRuimteState(['.ruimte', 'designs'])).toBe(true);
        expect(isRuimteState(['.ruimte', 'private', 'consoles'])).toBe(true);
        expect(isRuimteState(['.ruimte', 'private', 'designs'])).toBe(true);
        expect(isRuimteState(['.ruimte', 'private', 'consoles', 'shop', 'q 1.sql'])).toBe(false);
        expect(isRuimteState(['.ruimte', 'private', 'designs', 'home', 'index.html'])).toBe(false);
        expect(isRuimteState(['.ruimte', 'designs', 'home', 'index.html'])).toBe(false);
        expect(isRuimteState(['.ruimteish', 'a.ts'])).toBe(false);
        expect(isRuimteState(['src', '.ruimte', 'a.ts'])).toBe(false);
    });
});

describe('the console files of a project', () => {
    test('a console is named in the private state, in a folder of its connection', () => {
        expect(consolesFolderOf('/repo')).toBe('/repo/.ruimte/private/consoles');
        expect(consoleFolderOf('/repo', 'shop')).toBe('/repo/.ruimte/private/consoles/shop');
        expect(consoleFolderOf('/repo', 'a/b ü')).toBe('/repo/.ruimte/private/consoles/a%2Fb%20%C3%BC');
    });

    test('says which connection a console runs on by its folder, and nothing for any other file', () => {
        expect(consoleConnectionOf('/repo', '/repo/.ruimte/private/consoles/a%2Fb%20%C3%BC/q 1.sql')).toBe('a/b ü');
        expect(consoleConnectionOf('/repo', '/repo/.ruimte/private/consoles/shop/Q 1.SQL')).toBe('shop');
        expect(consoleConnectionOf('/repo', '/repo/.ruimte/private/consoles/shop/notes.txt')).toBeNull();
        expect(consoleConnectionOf('/repo', '/repo/.ruimte/private/consoles/q 1.sql')).toBeNull();
        expect(consoleConnectionOf('/repo', '/repo/.ruimte/private/consoles/shop/old/q 1.sql')).toBeNull();
        expect(consoleConnectionOf('/repo', '/repo/queries/q 1.sql')).toBeNull();
        expect(consoleConnectionOf('/repo', '/repo/.ruimte/private/consoles/%E0%A4/q.sql')).toBeNull();
    });

    test('knows a console on a Windows machine by its folder', () => {
        expect(consolesFolderOf('C:\\repo')).toBe('C:\\repo\\.ruimte\\private\\consoles');
        expect(consoleFolderOf('C:\\repo', 'shop')).toBe('C:\\repo\\.ruimte\\private\\consoles\\shop');
        expect(consoleConnectionOf('C:\\repo', 'C:\\repo\\.ruimte\\private\\consoles\\shop\\q 1.sql')).toBe('shop');
        expect(consoleConnectionOf('C:\\repo', 'C:\\repo\\.ruimte\\private\\consoles\\shop\\old\\q 1.sql')).toBeNull();
        expect(consoleConnectionOf('C:\\repo', 'C:\\repo2\\.ruimte\\private\\consoles\\shop\\q 1.sql')).toBeNull();
    });
});

describe('what a .sql file is read against', () => {
    const sql = {
        default: { connectionId: 'shop' },
        files: {
            'a.sql': { connectionId: 'local' },
            'b.sql': { connectionId: null },
            'c.sql': { connectionId: 'wide', database: 'stats' },
            'e.sql': { connectionId: 'gone' }
        }
    };
    const connections = [SHOP, WIDE, LOCAL];

    test('the database a connection starts in', () => {
        expect([SHOP, WIDE, LOCAL].map(startDatabaseOf)).toEqual(['shop', null, 'main']);
    });

    test('a console by its folder, a file by its own choice, anything else by the default', () => {
        expect(choiceFor('/repo', sql, connections, '/repo/.ruimte/private/consoles/wide/Wide 1.sql')).toEqual({
            source: 'console',
            connection: WIDE,
            database: null
        });
        expect(choiceFor('/repo', sql, connections, '/repo/a.sql')).toEqual({ source: 'file', connection: LOCAL, database: 'main' });
        expect(choiceFor('/repo', sql, connections, '/repo/b.sql')).toEqual({ source: 'unbound' });
        expect(choiceFor('/repo', sql, connections, '/repo/c.sql')).toEqual({ source: 'file', connection: WIDE, database: 'stats' });
        expect(choiceFor('/repo', sql, connections, '/repo/d.sql')).toEqual({ source: 'default', connection: SHOP, database: 'shop' });
        expect(choiceFor('/repo', {}, connections, '/repo/d.sql')).toEqual({ source: 'none' });
    });

    test('a choice of a connection that left the project falls back on the default', () => {
        expect(choiceFor('/repo', sql, connections, '/repo/e.sql')).toEqual({ source: 'default', connection: SHOP, database: 'shop' });
        expect(choiceFor('/repo', { files: sql.files }, connections, '/repo/e.sql')).toEqual({ source: 'none' });
    });

    test('a console reads its selected database instead of the empty connection default', () => {
        const path = '/repo/.ruimte/private/consoles/shop/Shop 1.sql';
        const chosen = { files: { '.ruimte/private/consoles/shop/Shop 1.sql': { connectionId: 'shop', database: 'pool_transvita' } } };
        expect(choiceFor('/repo', chosen, [SHOP], path)).toEqual({ source: 'console', connection: SHOP, database: 'pool_transvita' });
        expect(choiceFor('/repo', {}, [SHOP], path)).toEqual({ source: 'console', connection: SHOP, database: 'shop' });
    });

    test('a project without a folder keys the choice by the path itself and has no consoles', () => {
        expect(choiceFor(null, { files: { '/x/a.sql': { connectionId: 'local' } } }, connections, '/x/a.sql')).toEqual({
            source: 'file',
            connection: LOCAL,
            database: 'main'
        });
    });
});
