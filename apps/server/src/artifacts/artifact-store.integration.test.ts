import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdir, mkdtemp, readdir, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ArtifactProvenance } from '@ruimte/contracts';
import { readBytes } from '../bytes/read-bytes.ts';
import { MachineHome } from '../fs/machine-home.ts';
import { NODE_ARTIFACT_FS, type ArtifactFs } from './artifact-fs.ts';
import { ArtifactStore, type CommitInput } from './artifact-store.ts';
import { Artifacts } from './artifacts.ts';

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==', 'base64');
const PROVENANCE: ArtifactProvenance = { maker: 'agent', machineId: 'machine-1', chatId: 'chat-1', nodeId: 'chat-1' };

let base: string;
let home: string;
let project: string;
let outside: string;

beforeEach(async () => {
    base = await realpath(await mkdtemp(join(tmpdir(), 'ruimte-artifacts-')));
    home = join(base, 'home');
    project = join(base, 'project');
    outside = join(base, 'outside');
    await Promise.all([home, project, outside].map((folder) => mkdir(folder)));
});

afterEach(async () => {
    await rm(base, { recursive: true, force: true });
});

/* The real disk, with a stop that a test can put before one step. */
function stoppable(): { fs: ArtifactFs; stopAt: (step: keyof ArtifactFs, file?: string) => void } {
    let stop: { step: keyof ArtifactFs; file: string | undefined } | null = null;
    const fs = new Proxy(NODE_ARTIFACT_FS, {
        get(target, name: keyof ArtifactFs) {
            const step = target[name] as (...args: string[]) => Promise<unknown>;
            return (...args: string[]) => {
                if (stop !== null && stop.step === name && (stop.file === undefined || args[0]!.endsWith(stop.file))) {
                    stop = null;
                    return Promise.reject(new Error('stopped'));
                }
                return step(...args);
            };
        }
    });
    return { fs, stopAt: (step, file) => (stop = { step, file }) };
}

function input(overrides: Partial<CommitInput> = {}): CommitInput {
    return {
        projectId: 'project-1',
        projectName: 'Project',
        title: 'Report',
        requestId: 'request-1',
        provenance: PROVENANCE,
        names: ['report.md'],
        ...overrides
    };
}

async function storeOn(fs: ArtifactFs): Promise<ArtifactStore> {
    const store = new ArtifactStore({ root: join(home, 'artifacts'), fs });
    await store.load();
    return store;
}

async function stage(store: ArtifactStore, content: string): Promise<string> {
    const stagingId = await store.openStaging();
    await store.stageAppend(stagingId, 0, new TextEncoder().encode(content));
    return stagingId;
}

function artifactsOver(store: ArtifactStore): Artifacts {
    return new Artifacts({
        store,
        home,
        machineId: 'machine-1',
        projects: { known: async () => [{ projectId: 'project-1', name: 'Project', folder: project }], projectOf: () => 'project-1' },
        chats: { findAttachment: async () => null, hasStored: async () => true },
        machineHome: new MachineHome(home),
        provenanceOf: async () => PROVENANCE
    });
}

describe('artifact store on a real disk', () => {
    test('a stop between staging and the rename leaves no half version after a restart', async () => {
        const { fs, stopAt } = stoppable();
        const store = await storeOn(fs);
        const stagingId = await stage(store, '# Half');
        stopAt('rename');
        await expect(store.commit(stagingId, input())).rejects.toThrow('stopped');

        const restarted = await storeOn(fs);
        expect(restarted.list()).toEqual([]);
        expect((await readdir(join(home, 'artifacts'))).sort()).toEqual(['register.json']);
    });

    test('a stop between the rename and the register is a whole version after a restart, and a retry is that version', async () => {
        const { fs, stopAt } = stoppable();
        const store = await storeOn(fs);
        const stagingId = await stage(store, '# Whole');
        stopAt('writeDurable', 'register.json');
        await expect(store.commit(stagingId, input())).rejects.toThrow('stopped');

        const restarted = await storeOn(fs);
        const [summary] = restarted.list();
        expect(summary).toMatchObject({ versionCount: 1, latest: { number: 1, files: [{ name: 'report.md', size: 7 }] } });
        expect(JSON.parse(await readFile(join(home, 'artifacts', 'register.json'), 'utf8')).artifacts).toHaveLength(1);
        const retry = await restarted.commit(await stage(restarted, '# Whole'), input());
        expect(retry).toEqual({ artifactId: summary!.artifactId, versionId: summary!.latest.versionId, existing: true });
        expect(await readdir(join(home, 'artifacts', '.staging'))).toEqual([]);
        expect(restarted.list()).toHaveLength(1);
    });

    test('a stop between moving a version out and the register leaves it gone and nothing half after a restart', async () => {
        const { fs, stopAt } = stoppable();
        const store = await storeOn(fs);
        const first = await store.commit(await stage(store, 'one'), input({ key: 'k', requestId: 'a' }));
        const second = await store.commit(await stage(store, 'two'), input({ key: 'k', requestId: 'b' }));
        stopAt('writeDurable', 'register.json');
        await expect(store.remove(first.artifactId, [first.versionId])).rejects.toThrow('stopped');

        const restarted = await storeOn(fs);
        expect(restarted.get(first.artifactId)!.versions.map((version) => version.versionId)).toEqual([second.versionId]);
        expect((await readdir(join(home, 'artifacts', first.artifactId))).sort()).toEqual(['artifact.json', second.versionId]);
        expect(await readdir(join(home, 'artifacts'))).not.toContain('.staging');
        const register = JSON.parse(await readFile(join(home, 'artifacts', 'register.json'), 'utf8'));
        expect(register.artifacts[0].versions.map((version: { versionId: string }) => version.versionId)).toEqual([second.versionId]);
    });

    test('bytes.read serves a file of a version by its ids, with its hash as the version', async () => {
        const store = await storeOn(NODE_ARTIFACT_FS);
        const made = await store.commit(await stage(store, 'hello'), input());
        const artifacts = artifactsOver(store);
        const piece = await readBytes(
            { attachment: async () => null, projectIcon: async () => null, file: async () => null, artifact: async (...ids) => artifacts.file(...ids) },
            { resource: { kind: 'artifact', artifactId: made.artifactId, versionId: made.versionId, file: 0 }, offset: 0, length: 1024 }
        );
        expect(new TextDecoder().decode(piece.bytes)).toBe('hello');
        expect(piece.version).toBe(new Bun.CryptoHasher('sha256').update('hello').digest('hex'));
        expect(piece.mime).toBe('text/markdown');
    });

    test('copy to project writes beside nothing, refuses what is there and links on the way, and notes the copy', async () => {
        const store = await storeOn(NODE_ARTIFACT_FS);
        const artifacts = artifactsOver(store);
        const made = await store.commit(await stage(store, '# Copy'), input());
        const copy = { artifactId: made.artifactId, versionId: made.versionId, projectId: 'project-1' };

        expect(await artifacts.copyToProject({ ...copy, path: 'docs/report.md' })).toEqual(['docs/report.md']);
        expect(await readFile(join(project, 'docs', 'report.md'), 'utf8')).toBe('# Copy');
        await expect(artifacts.copyToProject({ ...copy, path: 'docs/report.md' })).rejects.toMatchObject({ code: 'exists' });

        await mkdir(join(home, 'elsewhere'));
        await symlink(join(home, 'elsewhere'), join(project, 'linked'));
        await expect(artifacts.copyToProject({ ...copy, path: 'linked/report.md' })).rejects.toMatchObject({ code: 'symlink' });
        await symlink(join(home, 'elsewhere', 'target.md'), join(project, 'dangling.md'));
        await expect(artifacts.copyToProject({ ...copy, path: 'dangling.md' })).rejects.toMatchObject({ code: 'exists' });
        expect(await readdir(join(home, 'elsewhere'))).toEqual([]);
        await expect(artifacts.copyToProject({ ...copy, path: '../outside.md' })).rejects.toMatchObject({ code: 'bad-path' });

        expect((await artifacts.get(made.artifactId)).versions[0]!.copiedTo).toEqual(['docs/report.md']);
    });

    test('a version of several files is copied into a folder of its own', async () => {
        const store = await storeOn(NODE_ARTIFACT_FS);
        const artifacts = artifactsOver(store);
        const stagingId = await store.openStaging();
        await store.stageAppend(stagingId, 0, new TextEncoder().encode('a'));
        await store.stageAppend(stagingId, 1, new TextEncoder().encode('b'));
        const made = await store.commit(stagingId, input({ names: ['a.txt', 'nested/b.txt'] }));
        const paths = await artifacts.copyToProject({ artifactId: made.artifactId, versionId: made.versionId, projectId: 'project-1', path: 'out' });
        expect(paths).toEqual(['out', 'out/a.txt', 'out/nested/b.txt']);
        expect(await readFile(join(project, 'out', 'nested', 'b.txt'), 'utf8')).toBe('b');
    });

    test('a person saves a picture from the project or the shots, never a link, the machine own state or a file that is no image', async () => {
        const store = await storeOn(NODE_ARTIFACT_FS);
        const artifacts = artifactsOver(store);
        const save = (path: string, requestId: string) =>
            artifacts.save({ projectId: 'project-1', requestId, source: { kind: 'image', chatId: 'chat-1', path } });
        await writeFile(join(project, 'shot.png'), PNG);
        await mkdir(join(home, 'screenshots'));
        await writeFile(join(home, 'screenshots', 'agent.png'), PNG);
        await writeFile(join(home, 'local.key'), PNG);
        await writeFile(join(project, 'notes.txt'), 'words');
        await writeFile(join(outside, 'picture.png'), PNG);
        await symlink(join(outside, 'picture.png'), join(project, 'link.png'));

        const saved = await save('shot.png', 'r1');
        expect((await artifacts.get(saved.artifactId)).artifact).toMatchObject({ title: 'shot', kind: 'image' });
        expect((await artifacts.get(saved.artifactId)).versions[0]!.provenance).toEqual({ maker: 'person', machineId: 'machine-1', chatId: 'chat-1' });
        await save(join(home, 'screenshots', 'agent.png'), 'r2');
        expect(await save('shot.png', 'r1')).toEqual(saved);
        await expect(save('link.png', 'r3')).rejects.toMatchObject({ code: 'symlink' });
        await expect(save(join(home, 'local.key'), 'r4')).rejects.toMatchObject({ code: 'machine-state' });
        await expect(save('notes.txt', 'r5')).rejects.toMatchObject({ code: 'not-an-image' });
        await expect(save(join(outside, 'picture.png'), 'r6')).rejects.toMatchObject({ code: 'outside-project' });
        expect(await artifacts.list({})).toHaveLength(2);
    });

    test('a design folder is kept whole as one version, its assets by their path in it, and never a link or a folder outside the project', async () => {
        const artifacts = artifactsOver(await storeOn(NODE_ARTIFACT_FS));
        const design = join(project, 'designs', 'onboarding');
        await mkdir(join(design, 'assets'), { recursive: true });
        await writeFile(join(design, 'Onboarding.html'), '<p>1</p>');
        await writeFile(join(design, 'assets', 'logo.png'), PNG);
        await writeFile(join(design, '.DS_Store'), 'x');
        await writeFile(join(outside, 'secret.txt'), 'secret');
        await symlink(join(outside, 'secret.txt'), join(design, 'secret.txt'));
        await symlink(outside, join(project, 'designs', 'escape'));
        const keep = (path: string, requestId: string) =>
            artifacts.saveFolder({ projectId: 'project-1', path, title: 'Onboarding', key: 'design-1', requestId });

        const first = await keep('designs/onboarding', 'k1');
        const listed = await artifacts.get(first.artifactId);
        expect(listed.versions[0]?.files.map((file) => file.name)).toEqual(['assets/logo.png', 'Onboarding.html']);
        expect(listed.versions[0]?.provenance).toEqual({ maker: 'person', machineId: 'machine-1' });

        await writeFile(join(design, 'Onboarding.html'), '<p>2</p>');
        const second = await keep('designs/onboarding', 'k2');
        expect(second.artifactId).toBe(first.artifactId);
        expect(await keep('designs/onboarding', 'k2')).toEqual(second);

        await expect(keep('designs/escape', 'k3')).rejects.toMatchObject({ code: 'outside-project' });
        await expect(keep('..', 'k4')).rejects.toMatchObject({ code: 'outside-project' });
        await expect(keep('.', 'k5')).rejects.toMatchObject({ code: 'outside-project' });
    });
});
