import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdir, mkdtemp, realpath, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ServerFrame } from '@ruimte/contracts';
import { FakeWatch } from '@ruimte/agents/watch-test-helpers';
import { readServedFile } from '../fs/read.ts';
import { MachineHome } from '../fs/machine-home.ts';
import { FolderWatcher } from '../fs/watch.ts';
import { Dispatcher } from '../dispatcher.ts';
import { registerBytesHandlers } from './bytes.ts';
import { registerFsHandlers } from './fs.ts';

const GIF = new TextEncoder().encode('GIF89a and then some');

let root: string;
let home: string;
let dispatcher: Dispatcher;

beforeEach(async () => {
    // The project folder holds the home, the way a person who opens their own home folder has it.
    root = await realpath(await mkdtemp(join(tmpdir(), 'ruimte-fs-handlers-')));
    home = join(root, 'ruimte-home');
    await mkdir(join(home, 'scratch'), { recursive: true });
    await mkdir(join(home, 'screenshots'));
    await mkdir(join(home, 'command-approvals'));
    await writeFile(join(home, 'local.key'), 'the local secret');
    await writeFile(join(home, 'endpoint.json'), '{"version":1,"id":"machine"}');
    await writeFile(join(home, 'command-approvals', 'approval.json'), '{}');
    await writeFile(join(home, 'portrait.gif'), GIF);
    await writeFile(join(home, 'scratch', 'notes.md'), '# Notes');
    await writeFile(join(home, 'screenshots', 'shot.gif'), GIF);
    await symlink(home, join(root, 'linked'));
    dispatcher = new Dispatcher();
    const machineHome = new MachineHome(home);
    registerFsHandlers(
        dispatcher,
        new FolderWatcher('linux', new FakeWatch(), 0),
        async () => ({ folders: [root], worktreesOf: async () => [], worktreesRoot: join(home, 'worktrees') }),
        machineHome
    );
    registerBytesHandlers(dispatcher, { attachment: () => null, projectIcon: async () => null, file: readServedFile }, machineHome);
});

afterEach(async () => {
    await rm(root, { recursive: true, force: true });
});

async function request(type: string, payload: unknown): Promise<ServerFrame> {
    const frames: ServerFrame[] = [];
    await dispatcher.handle({ id: 'paired', send: (frame) => frames.push(frame) }, JSON.stringify({ id: 'request', type, payload }));
    return frames[0]!;
}

const refused = { ok: false, error: { code: 'machine-state' } };

describe('the machine home', () => {
    test('fs.read refuses the local secret and the key pair', async () => {
        expect(await request('fs.read', { path: join(home, 'local.key') })).toMatchObject(refused);
        expect(await request('fs.read', { path: join(home, 'endpoint.json') })).toMatchObject(refused);
    });

    test('a symlink into the home does not lead around the refusal', async () => {
        expect(await request('fs.read', { path: join(root, 'linked', 'local.key') })).toMatchObject(refused);
    });

    test('the Chats project and the shots agents take still read', async () => {
        expect(await request('fs.read', { path: join(home, 'scratch', 'notes.md') })).toMatchObject({ ok: true, result: { kind: 'text', text: '# Notes' } });
        expect(await request('fs.read', { path: join(home, 'screenshots', 'shot.gif') })).toMatchObject({ ok: true, result: { kind: 'binary' } });
    });

    test('bytes.read serves a shot but no other picture of the home', async () => {
        const piece = (path: string) => request('bytes.read', { resource: { kind: 'file', path }, offset: 0, length: 6 });
        expect(await piece(join(home, 'portrait.gif'))).toMatchObject(refused);
        expect(await piece(join(home, 'screenshots', 'shot.gif'))).toMatchObject({ ok: true, result: { mime: 'image/gif' } });
    });

    test('fs.grep does not search the home', async () => {
        expect(await request('fs.grep', { cwd: home, query: 'secret' })).toMatchObject(refused);
    });

    test('a project folder around the home does not open it to a save', async () => {
        const approval = join(home, 'command-approvals', 'approval.json');
        const { mtimeMs } = await stat(approval);
        expect(await request('fs.write', { path: approval, text: '{"approved":true}', expectedMtime: Math.round(mtimeMs) })).toMatchObject(refused);
    });

    test('nor to a create', async () => {
        expect(await request('fs.create', { path: join(home, 'command-approvals', 'new.json'), kind: 'file' })).toMatchObject(refused);
    });

    test('nor to a delete', async () => {
        expect(await request('fs.delete', { path: join(home, 'command-approvals', 'approval.json') })).toMatchObject(refused);
    });

    test('nor to a move out of the home or into it', async () => {
        const approval = join(home, 'command-approvals', 'approval.json');
        expect(await request('fs.rename', { path: approval, to: join(root, 'taken.json') })).toMatchObject(refused);
        expect(await request('fs.rename', { path: join(home, 'portrait.gif'), to: join(home, 'command-approvals', 'portrait.gif') })).toMatchObject(refused);
    });

    test('fs.rename moves a file of the project', async () => {
        await writeFile(join(root, 'a.txt'), 'a');
        expect(await request('fs.rename', { path: join(root, 'a.txt'), to: join(root, 'moved', 'b.txt') })).toMatchObject({ ok: true, result: {} });
        expect((await stat(join(root, 'moved', 'b.txt'))).isFile()).toBe(true);
        expect(await request('fs.rename', { path: join(root, 'a.txt'), to: join(root, 'c.txt') })).toMatchObject({ ok: false, error: { code: 'not-found' } });
    });
});
