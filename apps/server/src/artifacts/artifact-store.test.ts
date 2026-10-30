import { describe, expect, test } from 'bun:test';
import type { ArtifactProvenance } from '@ruimte/contracts';
import { ArtifactStore, DISK_MARGIN_BYTES, type CommitInput } from './artifact-store.ts';
import { diskFull, MemoryArtifactFs } from './memory-artifact-fs.ts';

const ROOT = '/home/artifacts';
const PROVENANCE: ArtifactProvenance = { maker: 'agent', machineId: 'machine-1', chatId: 'chat-1', nodeId: 'chat-1' };

function storeOver(fs: MemoryArtifactFs, clock = { now: 1_000 }): ArtifactStore {
    let next = 0;
    return new ArtifactStore({ root: ROOT, fs, now: () => clock.now, newId: () => `id${String(++next).padStart(8, '0')}` });
}

function input(overrides: Partial<CommitInput> = {}): CommitInput {
    return {
        projectId: 'project-1',
        projectName: 'Ruimte',
        title: 'Report',
        requestId: 'request-1',
        provenance: PROVENANCE,
        names: ['report.md'],
        ...overrides
    };
}

async function staged(store: ArtifactStore, ...contents: string[]): Promise<string> {
    const stagingId = await store.openStaging();
    for (const [index, content] of contents.entries()) {
        await store.stageAppend(stagingId, index, new TextEncoder().encode(content));
    }
    return stagingId;
}

async function loaded(fs: MemoryArtifactFs): Promise<ArtifactStore> {
    const store = storeOver(fs);
    await store.load();
    return store;
}

function stagingLeft(fs: MemoryArtifactFs): string[] {
    return [...fs.folders, ...fs.files.keys()].filter((path) => path.startsWith(`${ROOT}/.staging/`));
}

describe('ArtifactStore', () => {
    test('a commit makes a version with hashed files, a kind read off them and the provenance it was given', async () => {
        const fs = new MemoryArtifactFs();
        const store = await loaded(fs);
        const result = await store.commit(await staged(store, '# Findings'), input());
        const [summary] = store.list();
        expect(result.existing).toBe(false);
        expect(summary).toMatchObject({ artifactId: result.artifactId, title: 'Report', kind: 'report', versionCount: 1, totalBytes: 10 });
        expect(summary!.latest).toMatchObject({ number: 1, createdAt: 1_000, provenance: PROVENANCE, copiedTo: [] });
        expect(summary!.latest.files).toEqual([
            { name: 'report.md', mime: 'text/markdown', size: 10, sha256: new Bun.CryptoHasher('sha256').update('# Findings').digest('hex') }
        ]);
        const file = store.file(result.artifactId, result.versionId, 0)!;
        expect(new TextDecoder().decode(fs.files.get(file.path.replaceAll('\\', '/')))).toBe('# Findings');
        expect(store.file(result.artifactId, result.versionId, 1)).toBeNull();
        expect(stagingLeft(fs)).toEqual([]);
    });

    test('the same key in a project is a new version of the same artifact, and the same key elsewhere is another artifact', async () => {
        const store = await loaded(new MemoryArtifactFs());
        const first = await store.commit(await staged(store, 'one'), input({ key: 'weekly', requestId: 'a' }));
        const second = await store.commit(await staged(store, 'two'), input({ key: 'weekly', requestId: 'b', title: 'Report, week 2' }));
        const other = await store.commit(await staged(store, 'three'), input({ key: 'weekly', requestId: 'c', projectId: 'project-2' }));
        expect(second.artifactId).toBe(first.artifactId);
        expect(other.artifactId).not.toBe(first.artifactId);
        const found = store.get(first.artifactId)!;
        expect(found.artifact.title).toBe('Report, week 2');
        expect(found.versions.map((version) => version.number)).toEqual([2, 1]);
    });

    test('a retry with the same request id answers the version it made and leaves its own staging behind', async () => {
        const fs = new MemoryArtifactFs();
        const store = await loaded(fs);
        const first = await store.commit(await staged(store, 'one'), input());
        const retry = await store.commit(await staged(store, 'one'), input());
        expect(retry).toEqual({ ...first, existing: true });
        expect(store.list()).toHaveLength(1);
        expect(stagingLeft(fs)).toEqual([]);
    });

    test('a stop between staging and the rename leaves no artifact and no staging after the next start', async () => {
        const fs = new MemoryArtifactFs();
        const store = await loaded(fs);
        const stagingId = await staged(store, 'half');
        fs.fail = (step) => (step === 'rename' ? new Error('stopped') : null);
        await expect(store.commit(stagingId, input())).rejects.toThrow('stopped');
        fs.fail = () => null;
        // What a process that died at the rename leaves: the staged folder, and the artifact's own file.
        expect([...fs.files.keys()].some((path) => path.endsWith('artifact.json'))).toBe(true);

        const restarted = await loaded(fs);
        expect(restarted.list()).toEqual([]);
        expect(stagingLeft(fs)).toEqual([]);
        expect([...fs.files.keys()].filter((path) => path !== `${ROOT}/register.json`)).toEqual([]);
    });

    test('a stop between the rename and the register is registered at the next start, and a retry lands on it', async () => {
        const fs = new MemoryArtifactFs();
        const store = await loaded(fs);
        const stagingId = await staged(store, 'whole');
        fs.fail = (step, path) => (step === 'writeDurable' && path.endsWith('register.json') ? new Error('stopped') : null);
        const made = store.commit(stagingId, input());
        await expect(made).rejects.toThrow('stopped');
        fs.fail = () => null;
        expect(await fs.readText(`${ROOT}/register.json`)).not.toContain('ver-');

        const restarted = await loaded(fs);
        const [summary] = restarted.list();
        expect(summary!.versionCount).toBe(1);
        expect(await fs.readText(`${ROOT}/register.json`)).toContain(summary!.latest.versionId);
        const retry = await restarted.commit(await staged(restarted, 'whole'), input());
        expect(retry).toEqual({ artifactId: summary!.artifactId, versionId: summary!.latest.versionId, existing: true });
    });

    test('a version whose files are not whole is no version at the next start', async () => {
        const fs = new MemoryArtifactFs();
        const store = await loaded(fs);
        const result = await store.commit(await staged(store, 'whole'), input({ key: 'k', requestId: 'a' }));
        const second = await store.commit(await staged(store, 'second'), input({ key: 'k', requestId: 'b' }));
        fs.put(store.file(second.artifactId, second.versionId, 0)!.path, 'cut');
        const restarted = await loaded(fs);
        expect(restarted.get(result.artifactId)!.versions.map((version) => version.versionId)).toEqual([result.versionId]);
    });

    test('a disk without room refuses before anything is written, and one that fills up keeps the versions there were', async () => {
        const fs = new MemoryArtifactFs();
        const store = await loaded(fs);
        const earlier = await store.commit(await staged(store, 'kept'), input({ requestId: 'a' }));
        fs.space = { free: DISK_MARGIN_BYTES + 10, size: 1 };
        await expect(store.ensureRoom(11)).rejects.toMatchObject({ code: 'disk-full' });
        await store.ensureRoom(10);

        const stagingId = await store.openStaging();
        fs.fail = (step) => (step === 'append' ? diskFull() : null);
        await expect(store.stageAppend(stagingId, 0, new Uint8Array(4))).rejects.toMatchObject({ code: 'disk-full' });
        fs.fail = (step, path) => (step === 'writeDurable' && path.endsWith('manifest.json') ? diskFull() : null);
        await expect(store.commit(await staged(store, 'new'), input({ requestId: 'b' }))).rejects.toMatchObject({ code: 'disk-full' });
        fs.fail = () => null;
        expect(store.list().map((summary) => summary.latest.versionId)).toEqual([earlier.versionId]);
        expect(stagingLeft(fs).filter((path) => !path.includes(stagingId))).toEqual([]);
    });

    test('a commit refuses files that did not all arrive and names that are paths', async () => {
        const store = await loaded(new MemoryArtifactFs());
        await expect(store.commit(await staged(store, 'one'), input({ names: ['a.md', 'b.md'] }))).rejects.toMatchObject({ code: 'upload-incomplete' });
        await expect(store.commit(await staged(store, 'one'), input({ names: ['../a.md'] }))).rejects.toMatchObject({ code: 'bad-name' });
        await expect(store.commit(await staged(store, 'one'), input({ key: 'Not A Key' }))).rejects.toMatchObject({ code: 'bad-key' });
        expect(store.list()).toEqual([]);
    });

    test('removing versions takes only those it may, never the latest, and survives a start', async () => {
        const fs = new MemoryArtifactFs();
        const store = await loaded(fs);
        const versions = [];
        for (const requestId of ['a', 'b', 'c']) {
            versions.push(await store.commit(await staged(store, requestId), input({ key: 'k', requestId })));
        }
        const [first, second, latest] = versions;
        const removed = await store.removeVersions(
            [first!, second!, latest!].map(({ artifactId, versionId }) => ({ artifactId, versionId })),
            (_artifact, version) => version.versionId !== second!.versionId
        );
        expect(removed).toEqual({ removed: 1, freedBytes: 1 });
        const restarted = await loaded(fs);
        expect(restarted.get(first!.artifactId)!.versions.map((version) => version.versionId)).toEqual([latest!.versionId, second!.versionId]);
    });

    test('a person removes any version, the latest and a copied one too, and that survives a start', async () => {
        const fs = new MemoryArtifactFs();
        const store = await loaded(fs);
        const first = await store.commit(await staged(store, 'one'), input({ key: 'k', requestId: 'a' }));
        const second = await store.commit(await staged(store, 'two!'), input({ key: 'k', requestId: 'b' }));
        await store.markCopied(second.artifactId, second.versionId, 'docs/report.md');
        const events: unknown[] = [];
        store.onChange((event) => events.push(event));

        expect(await store.remove(first.artifactId, [second.versionId])).toEqual({ removed: 1, freedBytes: 4 });
        expect(events).toEqual([{ artifactId: first.artifactId, projectId: 'project-1' }]);
        expect(stagingLeft(fs)).toEqual([]);
        const restarted = await loaded(fs);
        expect(restarted.get(first.artifactId)!.versions.map((version) => version.versionId)).toEqual([first.versionId]);
        await expect(restarted.remove(first.artifactId, ['ver-missing00'])).rejects.toMatchObject({ code: 'not-found' });
    });

    test('removing every version, or the artifact whole, removes the artifact and its folder', async () => {
        const fs = new MemoryArtifactFs();
        const store = await loaded(fs);
        const kept = await store.commit(await staged(store, 'one'), input({ key: 'k', requestId: 'a' }));
        const last = await store.commit(await staged(store, 'two'), input({ key: 'other', requestId: 'b' }));
        const events: unknown[] = [];
        store.onChange((event) => events.push(event));

        expect(await store.remove(last.artifactId, [last.versionId])).toEqual({ removed: 1, freedBytes: 3 });
        expect(await store.remove(kept.artifactId)).toEqual({ removed: 1, freedBytes: 3 });
        expect(events).toEqual([
            { artifactId: last.artifactId, projectId: 'project-1', removed: true },
            { artifactId: kept.artifactId, projectId: 'project-1', removed: true }
        ]);
        expect([...fs.folders, ...fs.files.keys()].filter((path) => path.includes('/art-'))).toEqual([]);
        expect((await loaded(fs)).list()).toEqual([]);
        await expect(store.remove(kept.artifactId)).rejects.toMatchObject({ code: 'not-found' });
    });

    test('a copy is noted on the version and kept across a start', async () => {
        const fs = new MemoryArtifactFs();
        const store = await loaded(fs);
        const made = await store.commit(await staged(store, 'one'), input());
        await store.markCopied(made.artifactId, made.versionId, 'docs/report.md');
        await store.markCopied(made.artifactId, made.versionId, 'docs/report.md');
        expect((await loaded(fs)).get(made.artifactId)!.versions[0]!.copiedTo).toEqual(['docs/report.md']);
    });

    test('changes are told to listeners with the project they are in', async () => {
        const store = await loaded(new MemoryArtifactFs());
        const events: unknown[] = [];
        store.onChange((event) => events.push(event));
        const made = await store.commit(await staged(store, 'one'), input());
        expect(events).toEqual([{ artifactId: made.artifactId, projectId: 'project-1' }]);
    });

    test('a chat filter finds an artifact by any of its versions', async () => {
        const store = await loaded(new MemoryArtifactFs());
        await store.commit(await staged(store, 'one'), input({ key: 'k', requestId: 'a' }));
        await store.commit(await staged(store, 'two'), input({ key: 'k', requestId: 'b', provenance: { maker: 'person', machineId: 'machine-1' } }));
        expect(store.list({ chatId: 'chat-1' })).toHaveLength(1);
        expect(store.list({ chatId: 'chat-2' })).toEqual([]);
        expect(store.list({ projectId: 'project-2' })).toEqual([]);
    });
});
