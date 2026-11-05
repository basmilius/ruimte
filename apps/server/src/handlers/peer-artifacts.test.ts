import { describe, expect, test } from 'bun:test';
import { PEER_ARTIFACT_PIECE_BYTES, type PeerLink, type ServerFrame } from '@ruimte/contracts';
import { ArtifactStore } from '../artifacts/artifact-store.ts';
import { Artifacts } from '../artifacts/artifacts.ts';
import { MemoryArtifactFs } from '../artifacts/memory-artifact-fs.ts';
import { Dispatcher } from '../dispatcher.ts';
import type { ClientConnection } from '../wire.ts';
import { registerPeerArtifactHandlers } from './peer-artifacts.ts';

class PeerSocket implements ClientConnection {
    readonly id = 'peer-client';
    readonly access = { reachability: 'lan', sessionId: 'peer-session', peer: { machineId: 'machine-a' } } as const;
    readonly frames: ServerFrame[] = [];

    send(frame: ServerFrame): void {
        this.frames.push(frame);
    }
}

type Reply = { ok: true; result: Record<string, unknown> } | { ok: false; error: { code: string } };

async function setup(linked: readonly string[]) {
    let next = 0;
    const store = new ArtifactStore({
        root: '/home/artifacts',
        fs: new MemoryArtifactFs(),
        now: () => 1_000,
        newId: () => `id${String(++next).padStart(8, '0')}`
    });
    await store.load();
    const save = async (projectId: string, name: string, bytes: Uint8Array): Promise<{ artifactId: string; versionId: string }> => {
        const stagingId = await store.openStaging();
        await store.stageAppend(stagingId, 0, bytes);
        return store.commit(stagingId, {
            projectId,
            projectName: projectId,
            title: name,
            requestId: `req-${name}`,
            provenance: { maker: 'person', machineId: 'machine-b' },
            names: [name]
        });
    };
    const artifacts = new Artifacts({
        store,
        home: '/home',
        machineId: 'machine-b',
        projects: { known: async () => [], projectOf: () => null },
        chats: { findAttachment: async () => null, hasStored: async () => false },
        machineHome: { refuse: async () => undefined },
        provenanceOf: async () => ({ maker: 'agent', machineId: 'machine-b' })
    });
    const links = linked.map((projectId): Omit<PeerLink, 'projectName'> => ({
        machineId: 'machine-a',
        label: 'Laptop',
        projectId,
        ceiling: 'supervised',
        createdAt: 0
    }));
    const dispatcher = new Dispatcher();
    registerPeerArtifactHandlers(
        dispatcher,
        { list: () => links, linkOf: (machineId, projectId) => links.find((link) => link.machineId === machineId && link.projectId === projectId) ?? null },
        artifacts
    );
    const socket = new PeerSocket();
    const ask = async (type: string, payload: unknown): Promise<Reply> => {
        await dispatcher.handle(socket, JSON.stringify({ id: `r${socket.frames.length}`, type, payload }));
        return socket.frames.at(-1) as unknown as Reply;
    };
    return { save, ask };
}

describe('what another machine reads of Output', () => {
    test('nothing without a link a person made here', async () => {
        const { save, ask } = await setup([]);
        const saved = await save('project-1', 'a.txt', new TextEncoder().encode('one'));
        expect(await ask('peer.artifactList', { projectId: 'project-1' })).toMatchObject({ ok: false, error: { code: 'peer-not-linked' } });
        expect(await ask('peer.artifactGet', { projectId: 'project-1', artifactId: saved.artifactId })).toMatchObject({
            ok: false,
            error: { code: 'peer-not-linked' }
        });
    });

    test('only the project its link names, and another project answers as if unlinked or not there', async () => {
        const { save, ask } = await setup(['project-1']);
        const own = await save('project-1', 'a.txt', new TextEncoder().encode('one'));
        const other = await save('project-2', 'b.txt', new TextEncoder().encode('two'));
        const list = await ask('peer.artifactList', { projectId: 'project-1' });
        expect(list.ok && (list.result.artifacts as Array<{ artifactId: string }>).map((row) => row.artifactId)).toEqual([own.artifactId]);
        expect(await ask('peer.artifactList', { projectId: 'project-2' })).toMatchObject({ ok: false, error: { code: 'peer-not-linked' } });
        expect(await ask('peer.artifactGet', { projectId: 'project-1', artifactId: other.artifactId })).toMatchObject({
            ok: false,
            error: { code: 'not-found' }
        });
        expect(
            await ask('peer.artifactRead', { projectId: 'project-1', artifactId: other.artifactId, versionId: other.versionId, file: 0, offset: 0, length: 10 })
        ).toMatchObject({ ok: false, error: { code: 'not-found' } });
    });

    test('a read answers at most one piece and refuses a longer one', async () => {
        const { save, ask } = await setup(['project-1']);
        const big = new Uint8Array(PEER_ARTIFACT_PIECE_BYTES + 10).fill(7);
        const saved = await save('project-1', 'big.bin', big);
        const read = { projectId: 'project-1', artifactId: saved.artifactId, versionId: saved.versionId, file: 0 };
        const first = await ask('peer.artifactRead', { ...read, offset: 0, length: PEER_ARTIFACT_PIECE_BYTES });
        expect(first.ok && Buffer.from(first.result.data as string, 'base64').byteLength).toBe(PEER_ARTIFACT_PIECE_BYTES);
        expect(first.ok && first.result.size).toBe(big.byteLength);
        const rest = await ask('peer.artifactRead', { ...read, offset: PEER_ARTIFACT_PIECE_BYTES, length: PEER_ARTIFACT_PIECE_BYTES });
        expect(rest.ok && Buffer.from(rest.result.data as string, 'base64').byteLength).toBe(10);
        expect(await ask('peer.artifactRead', { ...read, offset: 0, length: PEER_ARTIFACT_PIECE_BYTES + 1 })).toMatchObject({ ok: false });
    });
});
