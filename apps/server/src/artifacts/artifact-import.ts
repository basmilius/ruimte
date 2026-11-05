import { createHash } from 'node:crypto';
import { KeyedSerializer } from '@adecore/utils/async';
import {
    PEER_ARTIFACT_PIECE_BYTES,
    type ArtifactFile,
    type ArtifactGetResult,
    type ArtifactImportFromPayload,
    type ArtifactSaveResult,
    type ArtifactVersion,
    type PeerArtifactReadResult
} from '@ruimte/contracts';
import { ArtifactError } from './artifact-names.ts';
import type { ArtifactStore } from './artifact-store.ts';

/* What an import asks of an open link to another machine. */
interface PeerRequests {
    request<T>(type: string, payload: unknown): Promise<T>;
}

interface ArtifactImportDeps {
    store: ArtifactStore;
    machineId: string;
    known(): Promise<Array<{ projectId: string; name: string }>>;
    /* The project on that machine the project here is linked to; null without a link. */
    remoteProjectOf(projectId: string, machineId: string): string | null;
    /* An open link to that machine; its `request` reads every answer with the schema of the request (`checkedReply`). */
    connect(machineId: string): Promise<PeerRequests>;
}

/* The request id a copy of one version saves under, so asking twice lands once. */
function requestIdOf(machineId: string, artifactId: string, versionId: string): string {
    return `imp-${createHash('sha256').update(`${machineId}\0${artifactId}\0${versionId}`).digest('hex').slice(0, 40)}`;
}

/* What another machine refused, read off the message its reply carried (`code: message`). */
function refusalOf(e: unknown): string | null {
    const message = e instanceof Error ? e.message : '';
    return /^([a-z][a-z-]*): /.exec(message)?.[1] ?? null;
}

/* A failure of a request to the other machine in the words of this one, never with anything of the artifact in it. */
function importFailure(e: unknown): ArtifactError {
    if (e instanceof ArtifactError) {
        return e;
    }
    if (typeof e === 'object' && e !== null && 'code' in e && e.code === 'bad-reply') {
        return new ArtifactError('bad-reply', 'The other machine answered with something that is no part of this artifact');
    }
    switch (refusalOf(e)) {
        case 'not-found':
            return new ArtifactError('not-found', 'That version is no longer on the other machine');
        case 'peer-not-linked':
            return new ArtifactError('not-linked', 'The other machine no longer links this project');
        default:
            return new ArtifactError('machine-unreachable', 'The other machine did not answer');
    }
}

/*
 * A version another machine of the account keeps, copied into a project here when a person asks. The
 * other machine is not trusted: every file has to match the hash and size its manifest names before
 * anything is committed, and the bytes go through the store's staging, so a copy that fails leaves nothing.
 */
export class ArtifactImporter {
    private readonly deps: ArtifactImportDeps;
    private readonly running = new KeyedSerializer();

    constructor(deps: ArtifactImportDeps) {
        this.deps = deps;
    }

    async importFrom(payload: ArtifactImportFromPayload): Promise<ArtifactSaveResult> {
        const { deps } = this;
        const project = (await deps.known()).find((candidate) => candidate.projectId === payload.projectId);
        if (project === undefined) {
            throw new ArtifactError('not-found', 'No such project on this machine');
        }
        const remoteProjectId = deps.remoteProjectOf(payload.projectId, payload.machineId);
        if (remoteProjectId === null) {
            throw new ArtifactError('not-linked', 'This project is not linked to that machine');
        }
        const requestId = requestIdOf(payload.machineId, payload.artifactId, payload.versionId);
        // One copy of a version at a time, so a second click waits for the first and answers what it made.
        return this.running.run(requestId, async () => {
            const earlier = deps.store.findRequest(payload.projectId, requestId);
            if (earlier) {
                return { artifactId: earlier.artifactId, versionId: earlier.versionId };
            }
            const link = await deps.connect(payload.machineId).catch(() => {
                throw new ArtifactError('machine-unreachable', 'The other machine did not answer');
            });
            const found = await link
                .request<ArtifactGetResult>('peer.artifactGet', { projectId: remoteProjectId, artifactId: payload.artifactId })
                .catch((e: unknown) => {
                    throw importFailure(e);
                });
            const version = found.versions.find((candidate) => candidate.versionId === payload.versionId);
            if (found.artifact.projectId !== remoteProjectId || found.artifact.artifactId !== payload.artifactId || version === undefined) {
                throw new ArtifactError('not-found', 'That version is no longer on the other machine');
            }
            const bytes = version.files.reduce((sum, file) => sum + file.size, 0);
            const stage = async (stagingId: string): Promise<void> => {
                try {
                    for (const [index, file] of version.files.entries()) {
                        await this.fetchFile(link, { projectId: remoteProjectId, artifactId: payload.artifactId, version, index, file }, stagingId);
                    }
                } catch (e) {
                    throw importFailure(e);
                }
            };
            const committed = await deps.store.saveNew(bytes, stage, {
                projectId: payload.projectId,
                projectName: project.name,
                title: found.artifact.title,
                kind: found.artifact.kind,
                requestId,
                provenance: { maker: 'person', machineId: deps.machineId },
                names: version.files.map((file) => file.name),
                origin: {
                    machineId: payload.machineId,
                    artifactId: payload.artifactId,
                    versionId: payload.versionId,
                    provenance: version.provenance,
                    hashes: version.files.map((file) => file.sha256)
                }
            });
            return { artifactId: committed.artifactId, versionId: committed.versionId };
        });
    }

    /* Reads one file a piece at a time into staging and refuses it unless it is exactly the bytes the manifest names. */
    private async fetchFile(
        link: PeerRequests,
        place: { projectId: string; artifactId: string; version: ArtifactVersion; index: number; file: ArtifactFile },
        stagingId: string
    ): Promise<void> {
        const { store } = this.deps;
        const { file } = place;
        const hasher = createHash('sha256');
        // An empty file is a file too, and the store counts the ones staged.
        await store.stageAppend(stagingId, place.index, new Uint8Array());
        for (let offset = 0; offset < file.size;) {
            const piece = await link.request<PeerArtifactReadResult>('peer.artifactRead', {
                projectId: place.projectId,
                artifactId: place.artifactId,
                versionId: place.version.versionId,
                file: place.index,
                offset,
                length: Math.min(PEER_ARTIFACT_PIECE_BYTES, file.size - offset)
            });
            const bytes = Buffer.from(piece.data, 'base64');
            if (piece.size !== file.size || piece.offset !== offset || bytes.byteLength === 0 || offset + bytes.byteLength > file.size) {
                throw new ArtifactError('hash-mismatch', 'The other machine sent a file that differs from the one it named');
            }
            hasher.update(bytes);
            await store.stageAppend(stagingId, place.index, bytes);
            offset += bytes.byteLength;
        }
        if (hasher.digest('hex') !== file.sha256) {
            throw new ArtifactError('hash-mismatch', 'The other machine sent a file that differs from the one it named');
        }
    }
}
