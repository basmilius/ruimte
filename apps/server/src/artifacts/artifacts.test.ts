import { describe, expect, test } from 'bun:test';
import type { ArtifactProvenance } from '@ruimte/contracts';
import type { SessionEvent } from '../sessions/manager.ts';
import { pinKey } from './artifact-cleanup.ts';
import { ArtifactStore } from './artifact-store.ts';
import { Artifacts, MAX_OPEN_UPLOADS } from './artifacts.ts';
import { MemoryArtifactFs } from './memory-artifact-fs.ts';

const bytes = (value: string): Uint8Array => new TextEncoder().encode(value);

async function setup(pinned = new Set<string>()) {
    const fs = new MemoryArtifactFs();
    let next = 0;
    const store = new ArtifactStore({ root: '/home/artifacts', fs, now: () => 5_000, newId: () => `id${String(++next).padStart(8, '0')}` });
    await store.load();
    const provenance: ArtifactProvenance = { maker: 'agent', machineId: 'machine-1', chatId: 'chat-1', nodeId: 'chat-1', turnId: 'turn-1', taskId: 'task-1' };
    const artifacts = new Artifacts({
        store,
        home: '/home',
        machineId: 'machine-1',
        projects: {
            known: async () => [{ projectId: 'project-1', name: 'Ruimte', folder: '/work/ruimte' }],
            projectOf: (id) => (id.startsWith('chat-') ? 'project-1' : null)
        },
        chats: { findAttachment: async () => null, hasStored: async (chatId) => chatId === 'chat-1' },
        machineHome: { refuse: async () => undefined },
        provenanceOf: async (caller) => ({ ...provenance, chatId: caller, nodeId: caller }),
        pinned: () => pinned
    });
    return { fs, store, artifacts, provenance };
}

describe('Artifacts', () => {
    test('an upload goes on from where it stopped and becomes a version with the provenance of the call', async () => {
        const { artifacts, provenance } = await setup();
        expect(await artifacts.uploadAppend('chat-1', 'up-1', 0, 0, bytes('# Wee'))).toBe(5);
        await expect(artifacts.uploadAppend('chat-1', 'up-1', 0, 0, bytes('# Wee'))).rejects.toMatchObject({ code: 'upload-mismatch' });
        expect((await artifacts.uploadState('chat-1', 'up-1', 'req-1')).sizes).toEqual([5]);
        await artifacts.uploadAppend('chat-1', 'up-1', 0, 5, bytes('kly'));
        await artifacts.uploadAppend('chat-1', 'up-1', 1, 0, bytes('a,b'));
        const published = await artifacts.publish('chat-1', {
            upload: 'up-1',
            files: [
                { name: 'weekly.md', size: 8 },
                { name: 'data.csv', size: 3 }
            ],
            requestId: 'req-1'
        });
        expect(published.result.existing).toBe(false);
        expect(published.artifact).toMatchObject({ title: 'weekly', kind: 'report', projectId: 'project-1', projectName: 'Ruimte' });
        expect(published.version.provenance).toEqual(provenance);
        expect(published.version.files.map((file) => file.mime)).toEqual(['text/markdown', 'text/csv']);
        expect((await artifacts.uploadState('chat-1', 'up-1', 'req-1')).done).toMatchObject({ artifactId: published.result.artifactId });
    });

    test("an extension's files land in the project its call came from, as the person's, and a retry lands once", async () => {
        const { artifacts } = await setup();
        const input = { files: [{ name: 'weekly.md', bytes: bytes('# Weekly') }], key: 'weekly', requestId: 'req-1' };
        const first = await artifacts.publishFor('project-1', input);
        const retry = await artifacts.publishFor('project-1', input);

        expect(first.artifact).toMatchObject({ title: 'weekly', kind: 'report', projectId: 'project-1', key: 'weekly' });
        expect(first.version.provenance).toEqual({ maker: 'person', machineId: 'machine-1' });
        expect(retry.result).toEqual({ ...first.result, existing: true });
        await expect(artifacts.publishFor('project-2', { ...input, requestId: 'req-2' })).rejects.toMatchObject({ code: 'not-found' });
    });

    test('a retry of a publish lands on the version it made', async () => {
        const { artifacts } = await setup();
        await artifacts.uploadAppend('chat-1', 'up-1', 0, 0, bytes('one'));
        const first = await artifacts.publish('chat-1', { upload: 'up-1', files: [{ name: 'a.txt', size: 3 }], requestId: 'req-1' });
        await artifacts.uploadAppend('chat-1', 'up-1', 0, 0, bytes('one'));
        const retry = await artifacts.publish('chat-1', { upload: 'up-1', files: [{ name: 'a.txt', size: 3 }], requestId: 'req-1' });
        expect(retry.result).toEqual({ ...first.result, existing: true });
        expect(await artifacts.list({})).toHaveLength(1);
    });

    test('the same file published again from the same chat is a new version, and from another chat an artifact of its own', async () => {
        const { artifacts } = await setup();
        const publish = async (chatId: string, requestId: string) => {
            await artifacts.uploadAppend(chatId, requestId, 0, 0, bytes('one'));
            return artifacts.publish(chatId, { upload: requestId, files: [{ name: 'report.md', size: 3 }], requestId });
        };
        const first = await publish('chat-1', 'req-1');
        const again = await publish('chat-1', 'req-2');
        const elsewhere = await publish('chat-2', 'req-3');

        expect(again.artifact.artifactId).toBe(first.artifact.artifactId);
        expect(again.version.number).toBe(2);
        expect(elsewhere.artifact.artifactId).not.toBe(first.artifact.artifactId);
        expect(elsewhere.version.number).toBe(1);
    });

    test('a publish refuses files that did not all arrive, an upload past its limits and a session outside any project', async () => {
        const { artifacts } = await setup();
        await artifacts.uploadAppend('chat-1', 'up-1', 0, 0, bytes('one'));
        await expect(artifacts.publish('chat-1', { upload: 'up-1', files: [{ name: 'a.txt', size: 4 }], requestId: 'r' })).rejects.toMatchObject({
            code: 'upload-incomplete'
        });
        await expect(artifacts.publish('chat-1', { upload: 'up-2', files: [{ name: 'a.txt', size: 3 }], requestId: 'r' })).rejects.toMatchObject({
            code: 'upload-incomplete'
        });
        await expect(artifacts.uploadAppend('chat-1', 'up-1', 64, 0, bytes('x'))).rejects.toMatchObject({ code: 'too-large' });
        await expect(artifacts.uploadAppend('term-1', 'up-1', 0, 0, bytes('x'))).rejects.toMatchObject({ code: 'not-found' });
        for (let i = 2; i <= MAX_OPEN_UPLOADS; i++) {
            await artifacts.uploadAppend('chat-1', `up-${i}`, 0, 0, bytes('x'));
        }
        await expect(artifacts.uploadAppend('chat-1', 'up-99', 0, 0, bytes('x'))).rejects.toMatchObject({ code: 'too-many-uploads' });
        // Another session has uploads of its own.
        expect(await artifacts.uploadAppend('chat-2', 'up-1', 0, 0, bytes('x'))).toBe(1);
    });

    test('only a client that watches hears a change, and a closed one stops hearing it', async () => {
        const { artifacts } = await setup();
        const heard: Record<string, SessionEvent[]> = { watcher: [], other: [] };
        const unsubscribe = artifacts.subscribe('watcher', (event) => heard.watcher!.push(event));
        artifacts.subscribe('other', (event) => heard.other!.push(event));
        artifacts.watch('watcher');
        await artifacts.uploadAppend('chat-1', 'up-1', 0, 0, bytes('one'));
        await artifacts.publish('chat-1', { upload: 'up-1', files: [{ name: 'a.txt', size: 3 }], requestId: 'r1' });
        unsubscribe();
        await artifacts.uploadAppend('chat-1', 'up-2', 0, 0, bytes('two'));
        await artifacts.publish('chat-1', { upload: 'up-2', files: [{ name: 'b.txt', size: 3 }], requestId: 'r2' });
        expect(heard.watcher!.map((event) => event.event)).toEqual(['artifact.changed']);
        expect(heard.other).toEqual([]);
    });

    test('get says whether the chat of the latest version is still there', async () => {
        const { artifacts } = await setup();
        await artifacts.uploadAppend('chat-1', 'up-1', 0, 0, bytes('one'));
        const { result } = await artifacts.publish('chat-1', { upload: 'up-1', files: [{ name: 'a.txt', size: 3 }], requestId: 'r1' });
        expect((await artifacts.get(result.artifactId)).chatPresent).toBe(true);
        await expect(artifacts.get('art-missing00')).rejects.toMatchObject({ code: 'not-found' });
    });

    test('a confirmed cleanup removes exactly the versions sent, minus a pinned one', async () => {
        const pinned = new Set<string>();
        const { artifacts } = await setup(pinned);
        const made = [];
        for (const requestId of ['a', 'b', 'c']) {
            await artifacts.uploadAppend('chat-1', `up-${requestId}`, 0, 0, bytes(requestId));
            made.push(
                (await artifacts.publish('chat-1', { upload: `up-${requestId}`, files: [{ name: 'a.zip', size: 1 }], key: 'nightly', requestId })).result
            );
        }
        pinned.add(pinKey(made[1]!.artifactId, made[1]!.versionId));
        const removed = await artifacts.cleanupConfirm(made.map(({ artifactId, versionId }) => ({ artifactId, versionId })));
        expect(removed).toEqual({ removed: 1, freedBytes: 1 });
        const storage = await artifacts.storage();
        expect(storage.total).toEqual({ artifacts: 1, versions: 2, bytes: 2 });
        expect(storage.projects).toEqual([{ projectId: 'project-1', projectName: 'Ruimte', artifacts: 1, versions: 2, bytes: 2 }]);
    });
});
