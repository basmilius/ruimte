import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdir, mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ServerFrame } from '@ruimte/contracts';
import { FakeWatch } from '@adecore/agents/watch-test-helpers';
import { DatabaseConnectionStore } from '../database/connection-store.ts';
import { DatabaseService } from '../database/database-service.ts';
import { FakeHelper } from '../database/fake-helper.ts';
import { Dispatcher, type ClientAccess } from '../dispatcher.ts';
import { MachineHome } from '../fs/machine-home.ts';
import { registerDatabaseHandlers } from './database.ts';

const OWNER: ClientAccess = { reachability: 'loopback', sessionId: null };
const GUEST: ClientAccess = { reachability: 'lan', sessionId: 'session-1' };

let root: string;
let folder: string;
let dispatcher: Dispatcher;
let service: DatabaseService;
let connections: DatabaseConnectionStore;

async function call(clientId: string, type: string, payload: unknown, access?: ClientAccess): Promise<ServerFrame> {
    const frames: ServerFrame[] = [];
    await dispatcher.handle({ id: clientId, access, send: (frame) => frames.push(frame) }, JSON.stringify({ id: 'r1', type, payload }));
    return frames[0]!;
}

beforeEach(async () => {
    root = await realpath(await mkdtemp(join(tmpdir(), 'ruimte-database-handlers-')));
    folder = join(root, 'repo');
    await mkdir(join(folder, '.ruimte', 'private'), { recursive: true });
    service = new DatabaseService({ machineHome: new MachineHome(join(root, 'home')), start: () => new FakeHelper() });
    connections = new DatabaseConnectionStore({
        projects: { folderOf: (projectId) => (projectId === 'p1' ? folder : null), holdersOf: () => ['client-1'] },
        seams: new FakeWatch()
    });
    dispatcher = new Dispatcher();
    registerDatabaseHandlers(dispatcher, service, connections);
});

afterEach(async () => {
    connections.closeAll();
    await service.dispose();
    await rm(root, { recursive: true, force: true });
});

describe('database handlers', () => {
    test('a file is only for the socket that presented the local secret', async () => {
        const sample = { id: 'd1', method: 'sample', params: { path: join(root, 'customers.csv'), format: 'csv', header: true } };
        expect(await call('client-1', 'database.request', sample, OWNER)).toMatchObject({ ok: true, result: { id: 'd1', ok: true } });
        expect(await call('client-2', 'database.request', sample, GUEST)).toMatchObject({
            ok: true,
            result: { id: 'd1', ok: false, error: { code: 'forbidden' } }
        });
    });

    test('a malformed message comes back as the package answers it', async () => {
        expect(await call('client-1', 'database.request', { id: 'd1', method: 'drop-everything' }, OWNER)).toMatchObject({
            ok: true,
            result: { ok: false, error: { code: 'invalid-request' } }
        });
    });

    test('the connections are read and saved by a client that holds the project', async () => {
        const shop = { id: 'shop', name: 'Shop', config: { engine: 'sqlite', path: join(folder, 'shop.sqlite') }, shared: true };
        expect(await call('client-1', 'database.connections.save', { projectId: 'p1', baseRev: 0, connections: [shop] }, OWNER)).toMatchObject({
            ok: true,
            result: { rev: 1, connections: [shop] }
        });
        expect(await call('client-1', 'database.connections', { projectId: 'p1' }, OWNER)).toMatchObject({ ok: true, result: { rev: 1 } });
        expect(await call('client-2', 'database.connections', { projectId: 'p1' }, GUEST)).toMatchObject({ ok: false, error: { code: 'project-not-found' } });
    });
});
