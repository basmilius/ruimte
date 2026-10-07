import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { DatabaseConnection, ProjectContent } from '@ruimte/contracts';
import type { SessionEvent } from '../sessions/manager.ts';
import type { FileChange } from '../language/file-watch.ts';
import type { SchemaSnapshots, SnapshotFacts } from './schema-snapshots.ts';
import { boundTargets, choiceFor, consoleConnectionOf, consoleFolderOf, SqlAnalysis, sqlSettingsOf } from './sql-analysis.ts';

const FOLDER = '/work/shop';

const SHOP: DatabaseConnection = { id: 'shop', name: 'Shop', shared: true, config: { engine: 'mysql', host: 'db', user: 'app', database: 'shop' } };
const LOCAL: DatabaseConnection = { id: 'local', name: 'Local', shared: false, config: { engine: 'sqlite', path: '/work/shop/local.sqlite' } };
const WIDE: DatabaseConnection = { id: 'wide', name: 'Wide', shared: false, config: { engine: 'mysql', host: 'db', user: 'root' } };

function facts(connectionId: string, database: string | null, extra: Partial<SnapshotFacts> = {}): SnapshotFacts {
    return {
        path: `/home/snapshots/p1/${connectionId}/${database ?? '@all'}.json`,
        connectionId,
        database,
        dialect: 'mariadb',
        version: '11.4.2-MariaDB',
        takenAt: '2026-10-07T09:00:00.000Z',
        tables: 3,
        ...extra
    };
}

describe('what a file is read against', () => {
    const sql = {
        default: { connectionId: 'shop' },
        files: {
            'db/local.sql': { connectionId: 'local' },
            'db/loose.sql': { connectionId: null },
            'db/stats.sql': { connectionId: 'wide', database: 'stats' }
        }
    };
    const connections = [SHOP, LOCAL, WIDE];

    test('a console by its folder, a file by its own choice, anything else by the default', () => {
        const console = `${consoleFolderOf(FOLDER, 'local')}/Local 1.sql`;
        expect(consoleConnectionOf(FOLDER, console)).toBe('local');
        expect(choiceFor(FOLDER, sql, connections, console)).toMatchObject({ source: 'console', connection: { id: 'local' }, database: 'main' });
        expect(choiceFor(FOLDER, sql, connections, `${FOLDER}/db/local.sql`)).toMatchObject({ source: 'file', connection: { id: 'local' }, database: 'main' });
        expect(choiceFor(FOLDER, sql, connections, `${FOLDER}/db/stats.sql`)).toMatchObject({ source: 'file', database: 'stats' });
        expect(choiceFor(FOLDER, sql, connections, `${FOLDER}/db/loose.sql`)).toEqual({ source: 'unbound' });
        expect(choiceFor(FOLDER, sql, connections, `${FOLDER}/db/other.sql`)).toMatchObject({
            source: 'default',
            connection: { id: 'shop' },
            database: 'shop'
        });
        expect(choiceFor(FOLDER, {}, connections, `${FOLDER}/db/other.sql`)).toEqual({ source: 'none' });
    });

    test('a choice of a connection that left the project falls back on the default', () => {
        expect(choiceFor(FOLDER, { files: { 'a.sql': { connectionId: 'gone' } } }, connections, `${FOLDER}/a.sql`)).toEqual({ source: 'none' });
    });

    test('the targets the choices read, each once', () => {
        expect(boundTargets({ ...sql, files: { ...sql.files, 'b.sql': { connectionId: 'shop', database: 'shop' } } }, connections)).toEqual([
            { connectionId: 'shop', database: 'shop' },
            { connectionId: 'local', database: 'main' },
            { connectionId: 'wide', database: 'stats' }
        ]);
    });

    test('the settings: the default at the top, the consoles and the files by absolute path, and none listed apart', () => {
        const settings = sqlSettingsOf({
            folder: FOLDER,
            sql,
            connections,
            snapshots: [facts('shop', 'shop'), facts('local', 'main', { dialect: 'sqlite', version: '3.46.0' })]
        });
        expect(settings.sql).toEqual({
            dialect: 'mariadb',
            version: '11.4.2-MariaDB',
            schema: '/home/snapshots/p1/shop/shop.json',
            overrides: [
                { path: consoleFolderOf(FOLDER, 'shop'), dialect: 'mariadb', version: '11.4.2-MariaDB', schema: '/home/snapshots/p1/shop/shop.json' },
                { path: consoleFolderOf(FOLDER, 'local'), dialect: 'sqlite', version: '3.46.0', schema: '/home/snapshots/p1/local/main.json' },
                { path: consoleFolderOf(FOLDER, 'wide'), dialect: 'mysql' },
                { path: `${FOLDER}/db/local.sql`, dialect: 'sqlite', version: '3.46.0', schema: '/home/snapshots/p1/local/main.json' },
                { path: `${FOLDER}/db/stats.sql`, dialect: 'mysql' }
            ]
        });
        expect(settings.php).toEqual(settings.sql);
        expect(settings.unbound).toEqual([`${FOLDER}/db/loose.sql`]);
    });
});

class FakeSnapshots {
    taken: string[] = [];
    forgotten: string[] = [];
    listed: SnapshotFacts[] = [];
    failing = new Set<string>();

    async list(): Promise<SnapshotFacts[]> {
        return this.listed;
    }

    async forget(_projectId: string, connectionId: string): Promise<void> {
        this.forgotten.push(connectionId);
        this.listed = this.listed.filter((entry) => entry.connectionId !== connectionId);
    }

    async take(_projectId: string, connection: DatabaseConnection, database: string | null): Promise<SnapshotFacts> {
        this.taken.push(`${connection.id}/${database}`);
        if (this.failing.has(connection.id)) {
            throw new Error(`${connection.name} needs a password this machine does not have`);
        }
        const taken = facts(connection.id, database, { takenAt: `2026-10-07T10:00:0${this.taken.length}.000Z` });
        this.listed = [...this.listed.filter((entry) => entry.path !== taken.path), taken];
        return taken;
    }
}

let root = '';

beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'ruimte-sql-analysis-'));
});

afterEach(async () => {
    await rm(root, { recursive: true, force: true });
});

function analysisRig(connections: DatabaseConnection[] = [SHOP, LOCAL]) {
    let content: ProjectContent = { name: 'Shop', color: '#000', views: [] };
    const events: SessionEvent[] = [];
    const told: string[] = [];
    const changed: FileChange[][] = [];
    const snapshots = new FakeSnapshots();
    const access: Record<string, 'off' | 'read' | 'write'> = {};
    const analysis = new SqlAnalysis({
        projects: {
            folderOf: (projectId) => (projectId === 'p1' ? FOLDER : null),
            holdersOf: () => ['c1'],
            read: async () => content,
            mutate: async (_projectId, apply) => {
                const mutation = await apply(content);
                if (mutation.content !== null) {
                    content = mutation.content;
                }
                return mutation.result;
            }
        },
        connections: { connectionsOf: async () => connections },
        snapshots: snapshots as unknown as SchemaSnapshots,
        access: { levelOf: (_projectId, connectionId) => access[connectionId] ?? 'read' },
        warn: () => undefined
    });
    analysis.attach({
        sqlChanged: async (projectId) => {
            told.push(projectId);
        },
        outsideFilesChanged: async (changes) => {
            changed.push([...changes]);
        }
    });
    analysis.subscribe('c1', (event) => events.push(event));
    return { analysis, events, told, changed, snapshots, access, content: () => content };
}

/* Lets the work a call left running in the background finish. */
async function settle(): Promise<void> {
    for (let i = 0; i < 50; i++) {
        await Promise.resolve();
    }
}

describe('the SQL of a project', () => {
    test('a choice lands in the content, tells the servers and the clients, and takes the snapshot it reads', async () => {
        const rig = analysisRig();
        const state = await rig.analysis.bind('p1', `${FOLDER}/db/report.sql`, { connectionId: 'shop' }, 'c1');
        expect(rig.content().sql).toEqual({ files: { 'db/report.sql': { connectionId: 'shop' } } });
        expect(state.sql).toEqual(rig.content().sql!);
        expect(rig.told).toContain('p1');
        expect(rig.events.at(0)).toMatchObject({ event: 'language.sql.changed', payload: { projectId: 'p1' } });
        await settle();
        expect(rig.snapshots.taken).toEqual(['shop/shop']);
        expect(rig.changed).toEqual([[{ path: '/home/snapshots/p1/shop/shop.json', type: 1 }]]);
    });

    test('a default without a path, and null takes choices away until nothing is left', async () => {
        const rig = analysisRig();
        await rig.analysis.bind('p1', undefined, { connectionId: 'local' }, 'c1');
        await rig.analysis.bind('p1', 'a.sql', { connectionId: null }, 'c1');
        expect(rig.content().sql).toEqual({ default: { connectionId: 'local' }, files: { 'a.sql': { connectionId: null } } });
        await rig.analysis.bind('p1', 'a.sql', null, 'c1');
        await rig.analysis.bind('p1', undefined, null, 'c1');
        expect(rig.content().sql).toBeUndefined();
    });

    test('refuses a connection the project does not have, a file that is no SQL and a client that does not hold the project', async () => {
        const rig = analysisRig();
        await expect(rig.analysis.bind('p1', 'a.sql', { connectionId: 'gone' }, 'c1')).rejects.toMatchObject({ code: 'unknown-connection' });
        await expect(rig.analysis.bind('p1', 'a.php', { connectionId: 'shop' }, 'c1')).rejects.toMatchObject({ code: 'bad-path' });
        await expect(rig.analysis.state('p1', 'c2')).rejects.toMatchObject({ code: 'project-not-found' });
    });

    test('a refresh takes where a connection starts, what a choice reads and what is there, and fails only when nothing could be taken', async () => {
        const rig = analysisRig([SHOP, LOCAL, WIDE]);
        rig.snapshots.listed = [facts('shop', 'archive')];
        await rig.analysis.bind('p1', 'stats.sql', { connectionId: 'shop', database: 'stats' }, 'c1');
        await settle();
        rig.snapshots.taken = [];
        await rig.analysis.refresh('p1', 'c1', 'shop');
        expect(rig.snapshots.taken.sort()).toEqual(['shop/archive', 'shop/shop', 'shop/stats']);
        rig.snapshots.taken = [];
        await rig.analysis.refresh('p1', 'c1', 'shop', 'stats');
        expect(rig.snapshots.taken).toEqual(['shop/stats']);
        rig.snapshots.taken = [];
        await rig.analysis.refresh('p1', null);
        expect(rig.snapshots.taken.sort()).toEqual(['local/main', 'shop/archive', 'shop/shop', 'shop/stats', 'wide/null']);
        rig.snapshots.failing.add('local');
        await expect(rig.analysis.refresh('p1', 'c1', 'local')).rejects.toThrow('Local needs a password this machine does not have');
        await expect(rig.analysis.refresh('p1', 'c1', 'gone')).rejects.toMatchObject({ code: 'unknown-connection' });
    });

    test('a connection that left the project takes its snapshots along, and the servers hear of it', async () => {
        const rig = analysisRig();
        rig.snapshots.listed = [facts('shop', 'shop'), facts('gone', 'old')];
        await rig.analysis.connectionsChanged('p1', [SHOP]);
        expect(rig.snapshots.forgotten).toEqual(['gone']);
        expect(rig.told).toEqual(['p1']);
    });

    test('a client that handed over its passwords gets the snapshots its choices miss, and no others', async () => {
        const rig = analysisRig();
        await rig.analysis.bind('p1', undefined, { connectionId: 'shop' }, 'c1');
        await settle();
        rig.snapshots.taken = [];
        rig.analysis.passwordsHanded('p1');
        await settle();
        expect(rig.snapshots.taken).toEqual([]);
        rig.snapshots.listed = [];
        rig.analysis.passwordsHanded('p1');
        await settle();
        expect(rig.snapshots.taken).toEqual(['shop/shop']);
    });

    test('tells an agent what a file reads, with the access a person gave agents to that connection', async () => {
        const rig = analysisRig();
        rig.snapshots.listed = [facts('shop', 'shop')];
        rig.access.shop = 'off';
        await rig.analysis.bind('p1', undefined, { connectionId: 'shop' }, 'c1');
        const context = await rig.analysis.fileContext('p1', `${FOLDER}/a.sql`);
        expect(context).toMatchObject({
            choice: { source: 'default', database: 'shop' },
            snapshot: { path: '/home/snapshots/p1/shop/shop.json' },
            access: 'off'
        });
        expect((await rig.analysis.fileContext('p1', `${consoleFolderOf(FOLDER, 'local')}/Local 1.sql`)).access).toBe('read');
    });
});
