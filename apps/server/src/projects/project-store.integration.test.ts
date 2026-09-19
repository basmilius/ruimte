import { afterEach, beforeEach, expect, test } from 'bun:test';
import { mkdir, mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { SessionEvent } from '../sessions/manager.ts';
import { documentPathInFolder } from './project-files.ts';
import { ProjectStore } from './project-store.ts';

// A watcher on a loaded runner can take seconds, and a pass still ends the moment the change lands.
const DEADLINE_MS = 15_000;

let root: string;
let folder: string;
let store: ProjectStore;
let changed: SessionEvent[];

beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'ruimte-projects-watch-'));
    folder = join(root, 'repo');
    await mkdir(folder);
    store = new ProjectStore(join(root, 'home'));
    changed = [];
    store.subscribe('c1', (event) => {
        if (event.event === 'project.changed') {
            changed.push(event);
        }
    });
});

afterEach(async () => {
    store.closeAll();
    await rm(root, { recursive: true, force: true });
});

/*
 * Why the store watches the directory rather than the file: git and most editors replace the file
 * with a rename, and a watch on the old inode would never hear about the new one.
 */
test(
    'a project file replaced by a rename is reported',
    async () => {
        const opened = await store.openProject({ folder });
        const path = documentPathInFolder(folder);
        const pulled = { ...(JSON.parse(await readFile(path, 'utf8')) as Record<string, unknown>), name: 'from git' };
        await writeFile(`${path}.incoming`, JSON.stringify(pulled, null, 2));
        await rename(`${path}.incoming`, path);

        const deadline = Date.now() + DEADLINE_MS;
        while (changed.length === 0) {
            if (Date.now() > deadline) {
                throw new Error('No project.changed arrived');
            }
            await Bun.sleep(25);
        }
        // The rev is this machine's own: the shared file carries none, so a pull moves it one on.
        expect(changed[0]).toMatchObject({ payload: { projectId: opened.summary.projectId, document: { rev: 1, name: 'from git' } } });
    },
    DEADLINE_MS + 5_000
);
