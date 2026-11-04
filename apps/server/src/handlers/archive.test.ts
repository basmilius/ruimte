import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ServerFrame } from '@ruimte/contracts';
import { readArchiveEntry } from '../archive/archive.ts';
import { buildZip } from '../archive/test-archives.ts';
import { Dispatcher } from '../dispatcher.ts';
import { MachineHome } from '../fs/machine-home.ts';
import { readServedFile } from '../fs/read.ts';
import { registerArchiveHandlers } from './archive.ts';
import { registerBytesHandlers } from './bytes.ts';
import { askOnce } from './test-helpers.ts';

const ZIP = buildZip([{ name: 'docs/readme.md', data: '# Read me' }]);

let root: string;
let home: string;
let project: string;
let dispatcher: Dispatcher;

beforeEach(async () => {
    root = await realpath(await mkdtemp(join(tmpdir(), 'ruimte-archive-handlers-')));
    home = join(root, 'ruimte-home');
    project = join(root, 'project');
    await mkdir(join(home, 'scratch'), { recursive: true });
    await mkdir(join(home, 'secrets'));
    await mkdir(project);
    await writeFile(join(home, 'secrets', 'keys.zip'), ZIP);
    await writeFile(join(home, 'scratch', 'mine.zip'), ZIP);
    await writeFile(join(project, 'site.zip'), ZIP);
    dispatcher = new Dispatcher();
    const machineHome = new MachineHome(home);
    registerArchiveHandlers(dispatcher, async () => ({ folders: [project], worktreesOf: async () => [], worktreesRoot: join(home, 'worktrees') }), machineHome);
    registerBytesHandlers(
        dispatcher,
        { attachment: async () => null, projectIcon: async () => null, file: readServedFile, archiveEntry: readArchiveEntry },
        machineHome
    );
});

afterEach(async () => {
    await rm(root, { recursive: true, force: true });
});

function request(type: string, payload: unknown): Promise<ServerFrame> {
    return askOnce(dispatcher, { id: 'paired' }, type, payload);
}

const refused = { ok: false, error: { code: 'machine-state' } };

describe('archives and the machine home', () => {
    test('an archive in the machine state is neither listed nor read', async () => {
        expect(await request('archive.list', { path: join(home, 'secrets', 'keys.zip') })).toMatchObject(refused);
        expect(
            await request('bytes.read', {
                resource: { kind: 'file', path: join(home, 'secrets', 'keys.zip'), entry: 'docs/readme.md' },
                offset: 0,
                length: 100
            })
        ).toMatchObject(refused);
        expect(await request('archive.extract', { path: join(home, 'secrets', 'keys.zip'), to: join(project, 'keys') })).toMatchObject(refused);
    });

    test('an archive in the Chats project lists like any other', async () => {
        expect(await request('archive.list', { path: join(home, 'scratch', 'mine.zip') })).toMatchObject({ ok: true, result: { format: 'zip' } });
    });

    test('an entry comes over bytes.read with the mime of its own bytes', async () => {
        const reply = await request('bytes.read', {
            resource: { kind: 'file', path: join(project, 'site.zip'), entry: 'docs/readme.md' },
            offset: 0,
            length: 100
        });
        expect(reply).toMatchObject({ ok: true, result: { mime: 'text/plain; charset=utf-8', language: 'markdown', size: 9 } });
        expect(Buffer.from((reply as { result: { data: string } }).result.data, 'base64').toString('utf-8')).toBe('# Read me');
    });

    test('an extract lands only inside an open project', async () => {
        expect(await request('archive.extract', { path: join(project, 'site.zip'), to: join(root, 'elsewhere') })).toMatchObject({
            ok: false,
            error: { code: 'outside-project' }
        });
        expect(await request('archive.extract', { path: join(project, 'site.zip'), to: join(home, 'secrets', 'out') })).toMatchObject(refused);
        expect(await request('archive.extract', { path: join(project, 'site.zip'), to: join(project, 'site') })).toMatchObject({
            ok: true,
            result: { files: 1 }
        });
        expect(await readFile(join(project, 'site', 'docs', 'readme.md'), 'utf-8')).toBe('# Read me');
    });
});
