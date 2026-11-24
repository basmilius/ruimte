import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdir, mkdtemp, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FakeWatch } from '@adecore/agents/testing';
import { MachineHome } from '../disk/machine-home.ts';
import { SharedWatch } from '../disk/shared-watch.ts';
import { FolderWatcher } from '../fs/watch.ts';
import type { ExtensionFilesPort } from './extension-host.ts';
import { extensionProjectFiles } from './project-files.ts';

let root: string;
let folder: string;
let fake: FakeWatch;
let files: ExtensionFilesPort;

beforeEach(async () => {
    root = await realpath(await mkdtemp(join(tmpdir(), 'ruimte-extension-files-')));
    folder = join(root, 'project');
    await mkdir(join(folder, 'src'), { recursive: true });
    await mkdir(join(root, 'home'), { recursive: true });
    await writeFile(join(folder, 'harbor.yaml'), 'services:\n');
    await writeFile(join(folder, 'src', 'app.ts'), 'export {};\n');
    await writeFile(join(folder, 'logo.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 1, 2, 3]));
    await writeFile(join(root, 'secret.txt'), 'Not of the project');
    await writeFile(join(root, 'home', 'local.key'), 'The machine alone reads this');
    await symlink(join(root, 'secret.txt'), join(folder, 'linked.txt'));
    await symlink(join(root, 'home'), join(folder, 'machine'));
    fake = new FakeWatch();
    files = extensionProjectFiles({
        folderOf: (projectId) => (projectId === 'p1' ? folder : null),
        machineHome: new MachineHome(join(root, 'home')),
        // As the daemon wires it: one platform watcher per folder, shared by every watch of it.
        watcher: new FolderWatcher('darwin', new SharedWatch({ platform: 'darwin', seams: fake }), 0)
    });
});

afterEach(async () => {
    files.unwatchAll('dev.harbor');
    files.unwatchAll('dev.lintel');
    await rm(root, { recursive: true, force: true });
});

describe('the files of a project as an extension reads them', () => {
    test('are text files and folders inside the project folder', async () => {
        expect(await files.readText('p1', 'harbor.yaml')).toBe('services:\n');
        expect(await files.readText('p1', join(folder, 'src', 'app.ts'))).toBe('export {};\n');
        expect(await files.list('p1', 'src')).toEqual([{ path: join(folder, 'src', 'app.ts'), name: 'app.ts', kind: 'file' }]);
        await expect(files.readText('p1', 'logo.png')).rejects.toMatchObject({ code: 'refused', message: 'logo.png is not a text file' });
    });

    test('are never a file outside it, through a path, a link or the state of the machine', async () => {
        await expect(files.readText('p1', '../secret.txt')).rejects.toMatchObject({ code: 'outside-project' });
        await expect(files.readText('p1', 'linked.txt')).rejects.toMatchObject({ code: 'outside-project' });
        await expect(files.readText('p1', 'machine/local.key')).rejects.toThrow();
        await expect(files.list('p1', '..')).rejects.toMatchObject({ code: 'outside-project' });
        await expect(files.watch('dev.harbor', 1, 'p1', '../secret.txt', () => undefined)).rejects.toMatchObject({ code: 'outside-project' });
        await expect(files.readText('gone', 'harbor.yaml')).rejects.toMatchObject({ code: 'not-found' });
    });

    test('tell a watch of one file of that file alone, also one a save swaps in or that is not there yet', async () => {
        let harbor = 0;
        let later = 0;

        await files.watch('dev.harbor', 1, 'p1', 'harbor.yaml', () => (harbor += 1));
        await files.watch('dev.harbor', 2, 'p1', 'later.yaml', () => (later += 1));

        fake.on(folder).emit(join('src', 'app.ts'));
        await fake.settle();

        expect([harbor, later]).toEqual([0, 0]);

        // The folder is what is followed, so a new file under the old name is still that file.
        fake.on(folder).emit('harbor.yaml');
        fake.on(folder).emit('later.yaml');
        await fake.settle();

        expect([harbor, later]).toEqual([1, 1]);
    });

    test('tell a watch of a folder of everything under it, until that watch or all of its extension let go', async () => {
        let lintel = 0;
        let harbor = 0;

        await files.watch('dev.lintel', 1, 'p1', '.', () => (lintel += 1));
        await files.watch('dev.harbor', 1, 'p1', 'harbor.yaml', () => (harbor += 1));
        fake.on(folder).emit(join('src', 'app.ts'));
        await fake.settle();

        expect([lintel, harbor]).toEqual([1, 0]);

        files.unwatch('dev.lintel', 1);
        fake.on(folder).emit('harbor.yaml');
        await fake.settle();

        expect([lintel, harbor]).toEqual([1, 1]);

        files.unwatchAll('dev.harbor');

        // Nobody follows the folder any more, so nothing watches it.
        expect(fake.openOn(folder)).toEqual([]);
    });

    test('tell a watch of a burst that names no file, since it may have touched what the watch follows', async () => {
        let harbor = 0;

        await files.watch('dev.harbor', 1, 'p1', 'harbor.yaml', () => (harbor += 1));
        fake.on(folder).emit(null);
        await fake.settle();

        expect(harbor).toBe(1);
    });
});
