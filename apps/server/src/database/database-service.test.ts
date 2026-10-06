import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdir, mkdtemp, realpath, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MachineHome } from '../fs/machine-home.ts';
import { DatabaseService } from './database-service.ts';
import { FakeHelper } from './fake-helper.ts';

let root: string;
let home: string;
let helper: FakeHelper;
let service: DatabaseService;
let nextId = 1;

function request(method: string, params: Record<string, unknown>) {
    return { id: `r${nextId++}`, method, params };
}

function sqlite(path: string, create = false) {
    return request('open', { connection: create ? { engine: 'sqlite', path, create } : { engine: 'sqlite', path } });
}

function sample(path: string) {
    return request('sample', { path, format: 'csv', header: true });
}

beforeEach(async () => {
    root = await realpath(await mkdtemp(join(tmpdir(), 'ruimte-database-service-')));
    home = join(root, 'home');
    await mkdir(join(home, 'scratch'), { recursive: true });
    helper = new FakeHelper();
    service = new DatabaseService({ machineHome: new MachineHome(home), start: () => helper });
});

afterEach(async () => {
    await service.dispose();
    await rm(root, { recursive: true, force: true });
});

describe('DatabaseService', () => {
    test('a server opens however it is reached', async () => {
        const configs = [
            { engine: 'mysql', host: 'db.example.com', user: 'shop' },
            { engine: 'mysql', host: '127.0.0.1', socket: '/tmp/mysql.sock', user: 'root' },
            { engine: 'mysql', host: '10.0.3.12', user: 'shop', tunnel: { kind: 'ssh', host: 'bastion' } },
            { engine: 'mysql', host: '', user: 'root', tunnel: { kind: 'docker', container: 'shop-db-1' } }
        ];
        for (const connection of configs) {
            expect(await service.handle(request('test', { connection }), 'client-1')).toMatchObject({ ok: true });
        }
    });

    test('a SQLite file opens anywhere but in the machine state', async () => {
        expect(await service.handle(sqlite(join(root, 'shop.sqlite')), 'client-1')).toMatchObject({ ok: true });
        expect(await service.handle(sqlite(join(home, 'scratch', 'notes.sqlite'), true), 'client-1')).toMatchObject({ ok: true });
        expect(await service.handle(sqlite(join(home, 'auth.json')), 'client-1')).toMatchObject({ ok: false, error: { code: 'forbidden' } });
        expect(await service.handle(sqlite(join(home, 'state.sqlite'), true), 'client-1')).toMatchObject({ ok: false, error: { code: 'forbidden' } });
        expect(helper.written.map((message) => message.method)).toEqual(['open', 'open']);
    });

    test('a folder that links into the machine state is refused a new file', async () => {
        await symlink(home, join(root, 'innocent'));
        const response = await service.handle(sqlite(join(root, 'innocent', 'state.sqlite'), true), 'client-1');
        expect(response).toMatchObject({ ok: false, error: { code: 'forbidden' } });
    });

    test('only an owner that presented the local secret reads or writes a file', async () => {
        const path = join(root, 'customers.csv');
        expect(await service.handle(sample(path), 'client-1')).toMatchObject({ ok: false, error: { code: 'forbidden' } });
        expect(await service.handle(sample(path), 'agent:chat-1')).toMatchObject({ ok: false, error: { code: 'forbidden' } });
        expect(await service.handle(sample(path), 'client-2', true)).toMatchObject({ ok: true });

        await service.handle(sqlite(join(root, 'shop.sqlite')), 'client-2', true);
        const exported = request('export', {
            session: 's1',
            source: { kind: 'table', schema: 'main', table: 'orders' },
            format: 'csv',
            path: join(root, 'orders.csv')
        });
        expect(await service.handle(exported, 'client-2', true)).toMatchObject({ ok: true });
    });

    test('a local owner still stops at the machine state', async () => {
        expect(await service.handle(sample(join(home, 'auth.json')), 'client-2', true)).toMatchObject({ ok: false, error: { code: 'forbidden' } });
        expect(await service.handle(sample(join(home, 'scratch', 'import.csv')), 'client-2', true)).toMatchObject({ ok: true });
    });

    test('a released owner keeps no grant', async () => {
        const path = join(root, 'customers.csv');
        expect(await service.handle(sample(path), 'client-2', true)).toMatchObject({ ok: true });
        await service.release('client-2');
        expect(await service.handle(sample(path), 'client-2')).toMatchObject({ ok: false, error: { code: 'forbidden' } });
    });

    test('the containers of this machine are listed', async () => {
        expect(await service.handle(request('discover', { kind: 'docker' }), 'client-1')).toMatchObject({ ok: true, result: { containers: [] } });
    });

    test('a helper that cannot start answers that it is unavailable', async () => {
        const broken = new DatabaseService({
            machineHome: new MachineHome(home),
            start: () => {
                throw new Error('no helper');
            }
        });
        expect(await broken.handle(sqlite(join(root, 'shop.sqlite')), 'client-1')).toMatchObject({ ok: false, error: { code: 'helper-unavailable' } });
        await broken.dispose();
    });
});
