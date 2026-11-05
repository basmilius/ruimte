import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdir, mkdtemp, readFile, realpath, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FakeWatch } from '@adecore/agents/testing';
import { FS_WRITE_PIECE_BYTES, type FsListResult, type ServerFrame } from '@ruimte/contracts';
import { Dispatcher } from '../dispatcher.ts';
import { MachineHome } from '../fs/machine-home.ts';
import { readServedFile } from '../fs/read.ts';
import { FolderWatcher } from '../fs/watch.ts';
import { registerBytesHandlers } from './bytes.ts';
import { registerFsHandlers } from './fs.ts';
import { askOnce } from './test-helpers.ts';

const GIF = new TextEncoder().encode('GIF89a and then some');

let root: string;
let home: string;
let dispatcher: Dispatcher;
let watches: FakeWatch;
let folders: FolderWatcher;

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
    await mkdir(join(home, 'chats', 'chat-1.visuals'), { recursive: true });
    await writeFile(join(home, 'chats', 'chat-1.json'), '{}');
    await writeFile(join(home, 'chats', 'chat-1.visuals', 'report.html'), '<p>Report</p>');
    await symlink(home, join(root, 'linked'));
    dispatcher = new Dispatcher();
    watches = new FakeWatch();
    folders = new FolderWatcher('darwin', watches, 0);
    const machineHome = new MachineHome(home);
    registerFsHandlers(
        dispatcher,
        folders,
        async () => ({ folders: [root], worktreesOf: async () => [], worktreesRoot: join(home, 'worktrees') }),
        machineHome
    );
    registerBytesHandlers(dispatcher, { attachment: async () => null, projectIcon: async () => null, file: readServedFile }, machineHome);
});

afterEach(async () => {
    await rm(root, { recursive: true, force: true });
});

function request(type: string, payload: unknown): Promise<ServerFrame> {
    return askOnce(dispatcher, { id: 'paired' }, type, payload);
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

    test('a visual of a chat reads, the thread beside it does not', async () => {
        expect(await request('fs.read', { path: join(home, 'chats', 'chat-1.visuals', 'report.html') })).toMatchObject({
            ok: true,
            result: { kind: 'text', text: '<p>Report</p>' }
        });
        expect(await request('fs.read', { path: join(home, 'chats', 'chat-1.json') })).toMatchObject(refused);
        expect(await request('fs.read', { path: join(home, 'chats') })).toMatchObject(refused);
    });

    test('bytes.read serves a shot but no other picture of the home', async () => {
        const piece = (path: string) => request('bytes.read', { resource: { kind: 'file', path }, offset: 0, length: 6 });
        expect(await piece(join(home, 'portrait.gif'))).toMatchObject(refused);
        expect(await piece(join(home, 'screenshots', 'shot.gif'))).toMatchObject({ ok: true, result: { mime: 'image/gif' } });
    });

    test('fs.grep does not search the home', async () => {
        expect(await request('fs.grep', { cwd: home, query: 'secret' })).toMatchObject(refused);
    });

    test('fs.list names nothing of the home, but lists the folders it lets through', async () => {
        expect(await request('fs.list', { path: home })).toMatchObject(refused);
        expect(await request('fs.list', { path: join(home, 'chats') })).toMatchObject(refused);
        expect(await request('fs.list', { path: join(root, 'linked') })).toMatchObject(refused);
        expect(await request('fs.list', { path: join(home, 'scratch') })).toMatchObject({ ok: true, result: { entries: [{ name: 'notes.md' }] } });
        expect(await request('fs.list', { path: join(home, 'chats', 'chat-1.visuals') })).toMatchObject({
            ok: true,
            result: { entries: [{ name: 'report.html' }] }
        });
    });

    test('fs.list of a folder around the home does not descend into it', async () => {
        const reply = await request('fs.list', { path: root, depth: 3, hidden: true });
        const paths = (reply as { result: FsListResult }).result.entries.map((entry) => entry.path);

        expect(paths).toContain(home);
        expect(paths.filter((path) => path.startsWith(`${home}/`))).toEqual([]);
    });

    test('fs.watch refuses the home, and a watch around it hears nothing from inside', async () => {
        const changed: unknown[] = [];
        folders.subscribe('paired', (event) => {
            changed.push(event.payload);
        });

        expect(await request('fs.watch', { path: join(home, 'command-approvals') })).toMatchObject(refused);
        expect(await request('fs.watch', { path: root })).toMatchObject({ ok: true });

        watches.on(root).emit(join('ruimte-home', 'command-approvals', 'approval.json'));
        await watches.settle();
        expect(changed).toEqual([]);

        watches.on(root).emit(join('ruimte-home', 'scratch', 'notes.md'));
        await watches.settle();
        expect(changed).toEqual([{ root, paths: [join(home, 'scratch')], changedPaths: [join(home, 'scratch', 'notes.md')] }]);
    });

    test('a client that closed while its fs.watch was judged leaves no watcher behind', async () => {
        const client = { id: 'phone', closed: false, send: (_frame: ServerFrame) => undefined };

        const handled = dispatcher.handle(client, JSON.stringify({ id: 'watch', type: 'fs.watch', payload: { path: root } }));
        // The socket goes before the path was judged, and its cleanup ran with nothing to clean yet.
        client.closed = true;
        folders.detachAll('phone');
        await handled;

        expect(watches.openOn(root)).toHaveLength(0);
    });

    test('fs.browse completes nothing in the home, neither by its path nor from its cwd', async () => {
        expect(await request('fs.browse', { partialPath: `${home}/` })).toMatchObject(refused);
        expect(await request('fs.browse', { partialPath: join(home, 'cha') })).toMatchObject(refused);
        expect(await request('fs.browse', { partialPath: './', cwd: join(home, 'chats') })).toMatchObject(refused);
        expect(await request('fs.browse', { partialPath: root, cwd: join(home, 'chats') })).toMatchObject(refused);
        expect(await request('fs.browse', { partialPath: '../', cwd: join(home, 'scratch') })).toMatchObject(refused);
        expect(await request('fs.browse', { partialPath: './', cwd: join(home, 'scratch') })).toMatchObject({ ok: true, result: { entries: [] } });
        expect(await request('fs.browse', { partialPath: `${root}/ruimte` })).toMatchObject({ ok: true, result: { entries: [{ name: 'ruimte-home' }] } });
    });

    test('fs.reveal shows nothing of the home', async () => {
        expect(await request('fs.reveal', { path: home })).toMatchObject(refused);
        expect(await request('fs.reveal', { path: join(home, 'local.key') })).toMatchObject(refused);
        expect(await request('fs.reveal', { path: join(root, 'linked', 'command-approvals') })).toMatchObject(refused);
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

describe('a read within a folder', () => {
    const outside = { ok: false, error: { code: 'outside-project' } };
    let project: string;

    beforeEach(async () => {
        project = join(root, 'project');
        await mkdir(join(root, 'private'), { recursive: true });
        await mkdir(project);
        await writeFile(join(root, 'private', 'secret.txt'), 'secret');
        await writeFile(join(project, 'notes.md'), '# Notes');
        await symlink(join(root, 'private', 'secret.txt'), join(project, 'secret.txt'));
        await symlink(join(root, 'private'), join(project, 'private'));
    });

    test('follows no symlink out of the folder', async () => {
        expect(await request('fs.read', { path: join(project, 'secret.txt'), within: project })).toMatchObject(outside);
        expect(await request('fs.list', { path: join(project, 'private'), within: project })).toMatchObject(outside);
    });

    test('reads what is really inside it, and leaves a read without one as it was', async () => {
        expect(await request('fs.read', { path: join(project, 'notes.md'), within: project })).toMatchObject({ ok: true, result: { text: '# Notes' } });
        expect(await request('fs.list', { path: project, within: project })).toMatchObject({ ok: true });
        expect(await request('fs.read', { path: join(project, 'secret.txt') })).toMatchObject({ ok: true, result: { text: 'secret' } });
    });
});

describe('a write within a folder', () => {
    const outside = { ok: false, error: { code: 'outside-project' } };
    let project: string;

    beforeEach(async () => {
        // The sibling is inside the client's boundary, as another open project or a worktree is, but not inside the project.
        project = join(root, 'project');
        await mkdir(join(root, 'sibling'), { recursive: true });
        await mkdir(project);
        await writeFile(join(root, 'sibling', 'notes.md'), 'sibling');
        await symlink(join(root, 'sibling'), join(project, 'sibling'));
    });

    test('follows no symlink out of the folder, into the rest of the boundary', async () => {
        const mtime = Math.round((await stat(join(root, 'sibling', 'notes.md'))).mtimeMs);

        expect(await request('fs.write', { path: join(project, 'sibling', 'notes.md'), text: 'changed', expectedMtime: mtime, within: project })).toMatchObject(
            outside
        );
        expect(await request('fs.create', { path: join(project, 'sibling', 'new.md'), kind: 'file', text: 'new', within: project })).toMatchObject(outside);
        expect(await readFile(join(root, 'sibling', 'notes.md'), 'utf8')).toBe('sibling');
        expect(await stat(join(root, 'sibling', 'new.md')).catch(() => null)).toBeNull();
    });

    test('refuses a folder outside the boundary itself', async () => {
        const elsewhere = await realpath(await mkdtemp(join(tmpdir(), 'ruimte-fs-elsewhere-')));

        try {
            expect(await request('fs.create', { path: join(elsewhere, 'new.md'), kind: 'file', within: elsewhere })).toMatchObject(outside);
        } finally {
            await rm(elsewhere, { recursive: true, force: true });
        }
    });

    test('writes and creates what is really inside it', async () => {
        expect(await request('fs.create', { path: join(project, 'notes.md'), kind: 'file', text: 'a', within: project })).toMatchObject({ ok: true });

        const mtime = Math.round((await stat(join(project, 'notes.md'))).mtimeMs);

        expect(await request('fs.write', { path: join(project, 'notes.md'), text: 'b', expectedMtime: mtime, within: project })).toMatchObject({ ok: true });
        expect(await readFile(join(project, 'notes.md'), 'utf8')).toBe('b');
    });
});

describe('files that go past the language servers', () => {
    function withLanguage(): { calls: string[]; edits: boolean[] } {
        const calls: string[] = [];
        const edits: boolean[] = [];
        const language = {
            renameFiles: async (_client: string, _project: string, from: string, to: string, withEdits: boolean, file: { move(): Promise<void> }) => {
                calls.push(`rename ${from} ${to}`);
                edits.push(withEdits);
                await file.move();
                return [];
            },
            createFiles: async (_client: string, _project: string, path: string, directory: boolean, withEdits: boolean, file: { move(): Promise<void> }) => {
                calls.push(`create ${path} ${directory}`);
                edits.push(withEdits);
                await file.move();
                return ['/edited.ts'];
            },
            deleteFiles: async (_client: string, _project: string, path: string, withEdits: boolean, file: { move(): Promise<void> }) => {
                calls.push(`delete ${path}`);
                edits.push(withEdits);
                expect(await Bun.file(path).exists()).toBe(true);
                await file.move();
                return [];
            },
            saved: async (path: string, text: string) => {
                calls.push(`saved ${path} ${text}`);
            }
        };
        dispatcher = new Dispatcher();
        registerFsHandlers(
            dispatcher,
            new FolderWatcher('linux', new FakeWatch(), 0),
            async () => ({ folders: [root], worktreesOf: async () => [], worktreesRoot: join(home, 'worktrees') }),
            new MachineHome(home),
            language as never
        );
        return { calls, edits };
    }

    test('creates a file through the servers of the project and names the files they edited', async () => {
        const { calls, edits } = withLanguage();
        const path = join(root, 'made.ts');
        const reply = await request('fs.create', { path, kind: 'file', text: 'x', projectId: 'p1' });
        expect(reply).toMatchObject({ ok: true, result: { size: 1, edited: ['/edited.ts'] } });
        expect(calls).toEqual([`create ${path} false`]);
        expect(edits).toEqual([true]);
        expect(await Bun.file(path).text()).toBe('x');
    });

    test('asks the servers nothing of a create without a project, and passes edits false on', async () => {
        const { calls, edits } = withLanguage();
        await request('fs.create', { path: join(root, 'plain.ts'), kind: 'file' });
        expect(calls).toEqual([]);
        await request('fs.create', { path: join(root, 'quiet.ts'), kind: 'file', projectId: 'p1', edits: false });
        expect(edits).toEqual([false]);
    });

    test('tells the servers a file was written with the text it was written with', async () => {
        const { calls } = withLanguage();
        const path = join(root, 'saved.ts');
        await writeFile(path, 'old');
        const { mtimeMs } = await stat(path);

        expect(await request('fs.write', { path, text: 'new', expectedMtime: Math.round(mtimeMs) })).toMatchObject({ ok: true });
        expect(calls).toEqual([`saved ${path} new`]);
    });

    test('takes a save past one frame in pieces, tells the servers once and keeps a stale check', async () => {
        const { calls } = withLanguage();
        const path = join(root, 'large.txt');

        await writeFile(path, 'old');

        const { mtimeMs } = await stat(path);
        const text = 'é'.repeat(100_000);
        const bytes = Buffer.from(text);
        const upload = async (expectedMtime: number): Promise<ServerFrame> => {
            const started = await request('fs.writeStart', { path, size: bytes.byteLength, expectedMtime });
            const { uploadId } = (started as { result: { uploadId: string } }).result;

            for (let offset = 0; offset < bytes.byteLength; offset += FS_WRITE_PIECE_BYTES) {
                await request('fs.writePiece', { uploadId, offset, data: bytes.subarray(offset, offset + FS_WRITE_PIECE_BYTES).toString('base64') });
            }

            return request('fs.writeCommit', { uploadId });
        };

        expect(await upload(Math.round(mtimeMs))).toMatchObject({ ok: true });
        expect(await readFile(path, 'utf8')).toBe(text);
        expect(calls).toEqual([`saved ${path} ${text}`]);
        expect(await upload(Math.round(mtimeMs))).toMatchObject({ ok: false, error: { code: 'stale' } });
    });

    test('does not write an upload a piece of never arrived', async () => {
        const path = join(root, 'partial.txt');

        await writeFile(path, 'old');

        const { mtimeMs } = await stat(path);
        const started = await request('fs.writeStart', { path, size: 10, expectedMtime: Math.round(mtimeMs) });
        const { uploadId } = (started as { result: { uploadId: string } }).result;

        await request('fs.writePiece', { uploadId, offset: 0, data: Buffer.from('12345').toString('base64') });

        expect(await request('fs.writeCommit', { uploadId })).toMatchObject({ ok: false, error: { code: 'upload-incomplete' } });
        expect(await readFile(path, 'utf8')).toBe('old');
    });

    test('refuses overlapping upload pieces without counting a hole as received bytes', async () => {
        const path = join(root, 'overlap.txt');
        await writeFile(path, 'old');
        const { mtimeMs } = await stat(path);
        const started = await request('fs.writeStart', { path, size: 6, expectedMtime: Math.round(mtimeMs) });
        const { uploadId } = (started as { result: { uploadId: string } }).result;
        const piece = (offset: number, text: string) => request('fs.writePiece', { uploadId, offset, data: Buffer.from(text).toString('base64') });

        expect(await piece(0, 'abcd')).toMatchObject({ ok: true });
        expect(await piece(2, 'XY')).toMatchObject({ ok: false, error: { code: 'upload-invalid' } });
        expect(await request('fs.writeCommit', { uploadId })).toMatchObject({ ok: false, error: { code: 'upload-incomplete' } });
        expect(await readFile(path, 'utf8')).toBe('old');
    });

    test('accepts out of order upload pieces and identical retries, but refuses changed retries', async () => {
        const path = join(root, 'retry.txt');
        await writeFile(path, 'old');
        const { mtimeMs } = await stat(path);
        const started = await request('fs.writeStart', { path, size: 6, expectedMtime: Math.round(mtimeMs) });
        const { uploadId } = (started as { result: { uploadId: string } }).result;
        const piece = (offset: number, text: string) => request('fs.writePiece', { uploadId, offset, data: Buffer.from(text).toString('base64') });

        expect(await piece(4, 'ef')).toMatchObject({ ok: true });
        expect(await piece(0, 'abcd')).toMatchObject({ ok: true });
        expect(await piece(0, 'abcd')).toMatchObject({ ok: true });
        expect(await piece(0, 'XY')).toMatchObject({ ok: false, error: { code: 'upload-invalid' } });
        expect(await request('fs.writeCommit', { uploadId })).toMatchObject({ ok: true });
        expect(await readFile(path, 'utf8')).toBe('abcdef');
    });

    test('does not tell the servers about a write that is refused', async () => {
        const { calls } = withLanguage();

        expect(await request('fs.write', { path: join(home, 'command-approvals', 'approval.json'), text: 'x', expectedMtime: 0 })).toMatchObject({ ok: false });
        expect(calls).toEqual([]);
    });

    test('does not ask the servers about a delete that is refused', async () => {
        const { calls } = withLanguage();
        const reply = await request('fs.delete', { path: join(root, 'missing.ts'), projectId: 'p1' });
        expect(reply).toMatchObject({ ok: false, error: { code: 'not-found' } });
        expect(calls).toEqual([]);
    });

    test('refuses an overwrite of a folder, and replaces the text of a file', async () => {
        withLanguage();
        const path = join(root, 'over.ts');
        await writeFile(path, 'old old old');
        expect(await request('fs.create', { path, kind: 'file', text: 'new', overwrite: true })).toMatchObject({ ok: true, result: { size: 3 } });
        expect(await Bun.file(path).text()).toBe('new');
        expect(await request('fs.create', { path: join(root, 'screenshots-dir'), kind: 'directory' })).toMatchObject({ ok: true });
        expect(await request('fs.create', { path: join(root, 'screenshots-dir'), kind: 'file', overwrite: true })).toMatchObject({
            ok: false,
            error: { code: 'exists' }
        });
    });
});
