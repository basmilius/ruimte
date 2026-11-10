import { describe, expect, test } from 'bun:test';
import { PEER_ARTIFACT_PIECE_BYTES, type ArtifactProvenance } from '@ruimte/contracts';
import { checkedReply } from '../peer/giver/peer-reply.ts';
import { ArtifactImporter } from './artifact-import.ts';
import { ArtifactStore } from './artifact-store.ts';
import { Artifacts } from './artifacts.ts';
import { MemoryArtifactFs } from './memory-artifact-fs.ts';

const ORIGINAL: ArtifactProvenance = { maker: 'agent', machineId: 'machine-b', chatId: 'chat-b', turnId: 'turn-b' };

async function storeOn(fs: MemoryArtifactFs, prefix: string): Promise<ArtifactStore> {
    let next = 0;
    const store = new ArtifactStore({ root: '/home/artifacts', fs, now: () => 2_000, newId: () => `${prefix}${String(++next).padStart(8, '0')}` });
    await store.load();
    return store;
}

/* Machine B with one artifact in its linked project, and machine A that copies from it over a fake link. */
async function setup(options: { tamper?: (data: string) => string; unreachable?: boolean } = {}) {
    const remote = await storeOn(new MemoryArtifactFs(), 'b');
    const save = async (bytes: Uint8Array, requestId: string) => {
        const stagingId = await remote.openStaging();
        await remote.stageAppend(stagingId, 0, bytes);
        return remote.commit(stagingId, {
            projectId: 'remote-project',
            projectName: 'Ruimte',
            title: 'Weekly',
            key: 'weekly',
            requestId,
            provenance: ORIGINAL,
            names: ['weekly.md']
        });
    };
    const remoteArtifacts = new Artifacts({
        store: remote,
        home: '/home',
        machineId: 'machine-b',
        projects: { known: async () => [], projectOf: () => null },
        chats: { findAttachment: async () => null, hasStored: async () => true },
        machineHome: { refuse: async () => undefined },
        provenanceOf: async () => ORIGINAL
    });
    const fs = new MemoryArtifactFs();
    const local = await storeOn(fs, 'a');
    const requests: Array<{ type: string; length?: number }> = [];
    const link = {
        // The way an open link reads every answer of the other machine.
        request: async <T>(type: string, payload: unknown): Promise<T> => {
            const asked = payload as { projectId: string; artifactId: string; versionId: string; file: number; offset: number; length: number };
            requests.push({ type, ...(type === 'peer.artifactRead' ? { length: asked.length } : {}) });
            if (type === 'peer.artifactGet') {
                return checkedReply<T>(type, await remoteArtifacts.getIn(asked.projectId, asked.artifactId));
            }
            const piece = await remoteArtifacts.readPiece(asked.projectId, asked);
            return checkedReply<T>(type, { ...piece, data: options.tamper?.(piece.data) ?? piece.data });
        }
    };
    const importer = new ArtifactImporter({
        store: local,
        machineId: 'machine-a',
        known: async () => [{ projectId: 'local-project', name: 'Ruimte' }],
        remoteProjectOf: (projectId, machineId) => (projectId === 'local-project' && machineId === 'machine-b' ? 'remote-project' : null),
        connect: async () => {
            if (options.unreachable === true) {
                throw new Error('That machine is not online');
            }
            return link;
        }
    });
    return { save, local, fs, importer, requests };
}

function stagingLeft(fs: MemoryArtifactFs): string[] {
    return [...fs.files.keys()].filter((path) => path.includes('/.staging/'));
}

describe('ArtifactImporter', () => {
    test('copies a version with its origin, in pieces no longer than a peer read allows, made by the person here', async () => {
        const { save, local, importer, requests } = await setup();
        const text = 'x'.repeat(PEER_ARTIFACT_PIECE_BYTES * 2 + 5);
        const saved = await save(new TextEncoder().encode(text), 'r1');
        const copied = await importer.importFrom({
            machineId: 'machine-b',
            artifactId: saved.artifactId,
            versionId: saved.versionId,
            projectId: 'local-project'
        });
        const found = local.get(copied.artifactId)!;
        expect(found.artifact).toMatchObject({ projectId: 'local-project', title: 'Weekly', kind: 'report' });
        expect(found.artifact.key).toBeUndefined();
        const version = found.versions[0]!;
        expect(version.provenance).toEqual({ maker: 'person', machineId: 'machine-a' });
        expect(version.origin).toEqual({
            machineId: 'machine-b',
            artifactId: saved.artifactId,
            versionId: saved.versionId,
            provenance: ORIGINAL,
            hashes: [version.files[0]!.sha256]
        });
        const reads = requests.filter((request) => request.type === 'peer.artifactRead');
        expect(reads).toHaveLength(3);
        expect(reads.every((read) => read.length! <= PEER_ARTIFACT_PIECE_BYTES)).toBe(true);
    });

    test('a second copy of the same version answers the first, and a newer version joins the same artifact', async () => {
        const { save, local, importer, requests } = await setup();
        const first = await save(new TextEncoder().encode('one'), 'r1');
        const payload = { machineId: 'machine-b', artifactId: first.artifactId, versionId: first.versionId, projectId: 'local-project' };
        const copied = await importer.importFrom(payload);
        const asked = requests.length;
        expect(await importer.importFrom(payload)).toEqual(copied);
        expect(requests).toHaveLength(asked);
        const second = await save(new TextEncoder().encode('two'), 'r2');
        const again = await importer.importFrom({ ...payload, versionId: second.versionId });
        expect(again.artifactId).toBe(copied.artifactId);
        expect(local.get(copied.artifactId)!.versions.map((version) => version.number)).toEqual([2, 1]);
    });

    test('bytes that do not match the hash the other machine named are refused and leave nothing', async () => {
        const { save, local, fs, importer } = await setup({ tamper: () => Buffer.from('evil').toString('base64') });
        const saved = await save(new TextEncoder().encode('good'), 'r1');
        await expect(
            importer.importFrom({ machineId: 'machine-b', artifactId: saved.artifactId, versionId: saved.versionId, projectId: 'local-project' })
        ).rejects.toMatchObject({ code: 'hash-mismatch' });
        expect(local.list()).toEqual([]);
        expect(stagingLeft(fs)).toEqual([]);
    });

    test('a machine that does not answer, a project without a link and a version that is gone each say so', async () => {
        const unreachable = await setup({ unreachable: true });
        const saved = await unreachable.save(new TextEncoder().encode('one'), 'r1');
        const payload = { machineId: 'machine-b', artifactId: saved.artifactId, versionId: saved.versionId, projectId: 'local-project' };
        await expect(unreachable.importer.importFrom(payload)).rejects.toMatchObject({ code: 'machine-unreachable' });
        await expect(unreachable.importer.importFrom({ ...payload, machineId: 'machine-c' })).rejects.toMatchObject({ code: 'not-linked' });
        const reachable = await setup();
        await expect(reachable.importer.importFrom({ ...payload, versionId: 'ver-gone' })).rejects.toMatchObject({ code: 'not-found' });
        expect(reachable.local.list()).toEqual([]);
    });
});
