import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdir, mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ServerFrame } from '@ruimte/contracts';
import { FakeWatch } from '@adecore/agents/watch-test-helpers';
import { DatabaseAccessStore } from '../database/agent-access.ts';
import { AgentDatabases, connectionTarget } from '../database/agent-databases.ts';
import { DatabasePasswords } from '../database/agent-passwords.ts';
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
let passwords: DatabasePasswords;

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
    passwords = new DatabasePasswords();
    const access = new DatabaseAccessStore(join(root, 'home'));
    await access.load();
    const agents = new AgentDatabases({
        service,
        connections,
        projects: { holdersOf: () => ['client-1', 'client-2'] },
        access,
        passwords,
        scratchFolder: join(root, 'home', 'scratch')
    });
    dispatcher = new Dispatcher();
    registerDatabaseHandlers(dispatcher, service, connections, agents);
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

    test('agents read by default, and only the local secret lets them write', async () => {
        expect(await call('client-2', 'database.agentAccess', { projectId: 'p1' }, GUEST)).toMatchObject({ ok: true, result: { access: {} } });
        expect(await call('client-2', 'database.agentAccess.set', { projectId: 'p1', connectionId: 'shop', access: 'off' }, GUEST)).toMatchObject({
            ok: true,
            result: { access: { shop: 'off' } }
        });
        expect(await call('client-2', 'database.agentAccess.set', { projectId: 'p1', connectionId: 'shop', access: 'write' }, GUEST)).toMatchObject({
            ok: false,
            error: { code: 'forbidden' }
        });
        expect(await call('client-1', 'database.agentAccess.set', { projectId: 'p1', connectionId: 'shop', access: 'write' }, OWNER)).toMatchObject({
            ok: true,
            result: { access: { shop: 'write' } }
        });
        expect(await call('client-3', 'database.agentAccess', { projectId: 'p1' }, GUEST)).toMatchObject({ ok: false, error: { code: 'project-not-found' } });
    });

    test('a client of the project hands its passwords over, and nobody else', async () => {
        const shop = { id: 'shop', name: 'Shop', config: { engine: 'mysql' as const, host: '127.0.0.1', user: 'root' }, shared: false };
        await call('client-1', 'database.connections.save', { projectId: 'p1', baseRev: 0, connections: [shop] }, OWNER);
        expect(await call('client-1', 'database.passwords', { projectId: 'p1', passwords: { shop: 'hunter2' } }, OWNER)).toMatchObject({ ok: true });
        expect(passwords.passwordOf('p1', 'shop', connectionTarget(shop.config))).toBe('hunter2');
        expect(await call('client-3', 'database.passwords', { projectId: 'p1', passwords: { shop: 'other' } }, GUEST)).toMatchObject({
            ok: false,
            error: { code: 'project-not-found' }
        });
    });
});
