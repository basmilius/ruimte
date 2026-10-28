import { createHash } from 'node:crypto';
import { lstat, readdir, realpath } from 'node:fs/promises';
import { basename, join, relative, resolve } from 'node:path';
import {
    ARTIFACT_LIMITS,
    PEER_ARTIFACT_PIECE_BYTES,
    type Artifact,
    type ArtifactChangedEvent,
    type ArtifactCleanupProposal,
    type ArtifactCopyToProjectPayload,
    type ArtifactFile,
    type ArtifactGetResult,
    type ArtifactKind,
    type ArtifactProjectStorage,
    type ArtifactProvenance,
    type ArtifactRemovePayload,
    type ArtifactRemoveResult,
    type ArtifactSaveFolderPayload,
    type ArtifactSavePayload,
    type ArtifactSaveResult,
    type ArtifactStorageResult,
    type ArtifactSummary,
    type ArtifactVersion,
    type ArtifactVersionRef,
    type ChatAttachment
} from '@ruimte/contracts';
import { KeyedSerializer } from '@adecore/agents';
import { WatchedSinks } from '@adecore/agents/host';
import { isInside } from '../canvas/project-paths.ts';
import type { MachineHome } from '../fs/machine-home.ts';
import { sniffMime } from '../fs/sniff.ts';
import { DEVICE_CAPTURES_FOLDER } from '../shots.ts';
import type { SessionEvent, SessionSink } from '../sessions/manager.ts';
import { cleanupProposals, NO_PINS, removable, type PinnedVersions } from './artifact-cleanup.ts';
import { copyVersionInto } from './artifact-copy.ts';
import { ArtifactError, isTextMime, SNIFF_HEAD_BYTES } from './artifact-names.ts';
import { versionTooLarge, type ArtifactStore, type CommitResult } from './artifact-store.ts';
import { realOrNull } from '../fs/real-path.ts';

// One agent with this many publishes half sent holds them all; the next waits until one is done.
export const MAX_OPEN_UPLOADS = 8;

// What `artifact read` prints of a text file; past it the agent reads the rest from its own copy.
export const MAX_READ_BYTES = 256 * 1024;

interface ArtifactReading {
    artifact: Artifact;
    version: ArtifactVersion;
    file: ArtifactFile;
    /* Null for a file that is no text. */
    text: string | null;
    truncated: boolean;
}

/* What the service needs to know of a project: its name and its folder; null for a project this machine does not know. */
interface ArtifactProjects {
    known(): Promise<Array<{ projectId: string; name: string; folder: string }>>;
    /* The project a node, view or chat is in. */
    projectOf(id: string): string | null;
}

interface ArtifactChats {
    findAttachment(chatId: string, attachmentId: string): Promise<ChatAttachment | null>;
    hasStored(chatId: string): Promise<boolean>;
}

interface ArtifactsDeps {
    store: ArtifactStore;
    home: string;
    machineId: string;
    projects: ArtifactProjects;
    chats: ArtifactChats;
    machineHome: Pick<MachineHome, 'refuse'>;
    /* What the call context says of an agent caller; nothing of it comes from what the agent asks. */
    provenanceOf(caller: string): Promise<ArtifactProvenance>;
    pinned?: PinnedVersions;
}

interface PublishInput {
    upload: string;
    files: ReadonlyArray<{ name: string; size: number }>;
    title?: string;
    kind?: ArtifactKind;
    key?: string;
    requestId: string;
}

interface DeliverInput {
    projectId: string;
    key: string;
    title: string;
    kind?: ArtifactKind;
    requestId: string;
    provenance: ArtifactProvenance;
    files: ReadonlyArray<{ name: string; bytes: Uint8Array }>;
}

export interface UploadState {
    /* The bytes each staged file holds, by its place. */
    sizes: number[];
    /* The version an earlier publish with this request id made, so a retry need not send its bytes again. */
    done: CommitResult | null;
}

interface OpenUpload {
    caller: string;
    stagingId: string;
}

/* The names a picture made for a person is in, under the machine's own folder. */
function shotFolders(home: string): string[] {
    return [join(home, 'screenshots'), join(home, 'computer-use', 'screenshots'), join(home, DEVICE_CAPTURES_FOLDER)];
}

/* A label from a title: no folders, no control characters. */
function labelOf(text: string, fallback: string): string {
    // oxlint-disable-next-line no-control-regex -- a control character never reaches a name.
    const cleaned = text.replace(/[/\\\u0000-\u001f\u007f]/g, '-').trim();
    return cleaned === '' || cleaned === '.' || cleaned === '..' ? fallback : cleaned.slice(0, ARTIFACT_LIMITS.fileNameLength);
}

function titleOf(name: string): string {
    const dot = name.lastIndexOf('.');
    return (dot > 0 ? name.slice(0, dot) : name).slice(0, ARTIFACT_LIMITS.titleLength) || 'Untitled';
}

/*
 * Output on this machine: what a person saves from a chat, what an agent publishes, reading it back,
 * copying it into a project and the cleanup a person confirms. Every write goes through the store.
 */
export class Artifacts {
    private readonly store: ArtifactStore;
    private readonly deps: ArtifactsDeps;
    private readonly pinned: PinnedVersions;
    private readonly sinks = new WatchedSinks<SessionEvent>();
    private readonly uploads = new Map<string, OpenUpload>();
    private readonly uploadWrites = new KeyedSerializer();

    constructor(deps: ArtifactsDeps) {
        this.deps = deps;
        this.store = deps.store;
        this.pinned = deps.pinned ?? NO_PINS;
        this.store.onChange((event) => this.changed(event));
    }

    subscribe(clientId: string, sink: SessionSink): () => void {
        return this.sinks.subscribe(clientId, sink);
    }

    watch(clientId: string): void {
        this.sinks.watch(clientId);
    }

    unwatch(clientId: string): void {
        this.sinks.unwatch(clientId);
    }

    async list(filter: { projectId?: string; chatId?: string }): Promise<ArtifactSummary[]> {
        const names = await this.projectNames();
        return this.store.list(filter).map((summary) => this.named(names, summary));
    }

    async get(artifactId: string): Promise<ArtifactGetResult> {
        const found = this.store.get(artifactId);
        if (!found) {
            throw new ArtifactError('not-found', 'No such artifact on this machine');
        }
        const chatId = found.versions[0]!.provenance.chatId;
        const chatPresent = chatId === undefined ? false : await this.deps.chats.hasStored(chatId);
        return { artifact: this.named(await this.projectNames(), found.artifact), versions: found.versions, chatPresent };
    }

    /* A file to serve, by ids only. */
    file(artifactId: string, versionId: string, index: number): { path: string; mime: string; sha256: string } | null {
        const found = this.store.file(artifactId, versionId, index);
        return found ? { path: found.path, mime: found.file.mime, sha256: found.file.sha256 } : null;
    }

    /*
     * A person keeps a folder of the project as it stands, such as a design: every regular file under it,
     * named by its path inside it. A link is never followed, so nothing outside the folder comes along.
     */
    async saveFolder(payload: ArtifactSaveFolderPayload): Promise<ArtifactSaveResult> {
        const project = await this.requireProject(payload.projectId);
        const earlier = this.store.findRequest(payload.projectId, payload.requestId);
        if (earlier) {
            return { artifactId: earlier.artifactId, versionId: earlier.versionId };
        }
        const root = resolve(project.folder, payload.path);
        const real = await realOrNull(root);
        const realProject = await realOrNull(project.folder);
        if (real === null || realProject === null || real === realProject || !isInside(realProject, real)) {
            throw new ArtifactError('outside-project', 'Only a folder inside the project can be kept');
        }
        const files = await filesUnder(root, ARTIFACT_LIMITS.filesPerVersion);
        if (files.length === 0) {
            throw new ArtifactError('not-found', 'The folder holds no files to keep');
        }
        const bytes = files.reduce((sum, file) => sum + file.size, 0);
        if (bytes > ARTIFACT_LIMITS.versionBytes) {
            throw versionTooLarge();
        }
        const committed = await this.store.saveNew(
            bytes,
            async (stagingId) => {
                for (const [index, file] of files.entries()) {
                    await this.store.stageCopy(stagingId, index, file.path);
                }
            },
            {
                projectId: payload.projectId,
                projectName: project.name,
                title: payload.title,
                ...(payload.kind === undefined ? {} : { kind: payload.kind }),
                ...(payload.key === undefined ? {} : { key: payload.key }),
                requestId: payload.requestId,
                provenance: { maker: 'person', machineId: this.deps.machineId },
                names: files.map((file) => file.name)
            }
        );
        return { artifactId: committed.artifactId, versionId: committed.versionId };
    }

    /* A person saves what a chat of the project shows; the same request id lands once. */
    async save(payload: ArtifactSavePayload): Promise<ArtifactSaveResult> {
        const project = await this.requireProject(payload.projectId);
        const { source } = payload;
        if (this.deps.projects.projectOf(source.chatId) !== payload.projectId) {
            throw new ArtifactError('chat-elsewhere', 'That chat is not in this project');
        }
        const earlier = this.store.findRequest(payload.projectId, payload.requestId);
        if (earlier) {
            return { artifactId: earlier.artifactId, versionId: earlier.versionId };
        }
        const found = await this.sourceFile(source, project.folder);
        const size = (await lstat(found.path)).size;
        const committed = await this.store.saveNew(size, (stagingId) => this.store.stageCopy(stagingId, 0, found.path), {
            projectId: payload.projectId,
            projectName: project.name,
            title: payload.title ?? found.title,
            ...((payload.kind ?? found.kind) === undefined ? {} : { kind: payload.kind ?? found.kind }),
            ...(payload.key === undefined ? {} : { key: payload.key }),
            requestId: payload.requestId,
            provenance: { maker: 'person', machineId: this.deps.machineId, chatId: source.chatId },
            names: [found.name]
        });
        return { artifactId: committed.artifactId, versionId: committed.versionId };
    }

    /* What an agent's upload holds so far, so an interrupted publish goes on where it stopped. */
    async uploadState(caller: string, upload: string, requestId: string | null): Promise<UploadState> {
        const projectId = this.requireCallerProject(caller);
        const stagingId = this.stagingIdFor(caller, upload);
        const known = this.uploads.has(stagingId);
        const sizes = known ? await this.store.stagedSizes(stagingId) : new Map<number, number>();
        const list: number[] = [];
        for (let i = 0; sizes.has(i); i++) {
            list.push(sizes.get(i)!);
        }
        return { sizes: list, done: requestId === null ? null : this.store.findRequest(projectId, requestId) };
    }

    /* Adds a piece of an agent's file to its upload; a piece that does not start where the file ends is refused with the size it has. */
    async uploadAppend(caller: string, upload: string, index: number, offset: number, bytes: Uint8Array): Promise<number> {
        this.requireCallerProject(caller);
        const stagingId = this.stagingIdFor(caller, upload);
        return this.uploadWrites.run(stagingId, async () => {
            if (index < 0 || index >= ARTIFACT_LIMITS.filesPerVersion) {
                throw new ArtifactError('too-large', `A version holds at most ${ARTIFACT_LIMITS.filesPerVersion} files`);
            }
            if (!this.uploads.has(stagingId)) {
                const open = [...this.uploads.values()].filter((candidate) => candidate.caller === caller).length;
                if (open >= MAX_OPEN_UPLOADS) {
                    throw new ArtifactError('too-many-uploads', `At most ${MAX_OPEN_UPLOADS} publishes of one session are on their way at once`);
                }
                await this.store.openStaging(stagingId);
                this.uploads.set(stagingId, { caller, stagingId });
            }
            const sizes = await this.store.stagedSizes(stagingId);
            const current = sizes.get(index) ?? 0;
            if (offset !== current) {
                throw new ArtifactError('upload-mismatch', `This file holds ${current} bytes here; send from offset ${current}`);
            }
            const total = [...sizes.values()].reduce((sum, size) => sum + size, 0);
            if (total + bytes.byteLength > ARTIFACT_LIMITS.versionBytes) {
                await this.dropUpload(stagingId);
                throw versionTooLarge();
            }
            try {
                await this.store.ensureRoom(bytes.byteLength);
                await this.store.stageAppend(stagingId, index, bytes);
            } catch (e) {
                await this.dropUpload(stagingId);
                throw e;
            }
            return current + bytes.byteLength;
        });
    }

    /* Turns an agent's finished upload into a version of an artifact of its own project. */
    async publish(caller: string, input: PublishInput): Promise<{ result: CommitResult; artifact: Artifact; version: ArtifactVersion }> {
        const projectId = this.requireCallerProject(caller);
        const project = await this.requireProject(projectId);
        const stagingId = this.stagingIdFor(caller, input.upload);
        return this.uploadWrites.run(stagingId, async () => {
            const earlier = this.store.findRequest(projectId, input.requestId);
            if (earlier) {
                await this.dropUpload(stagingId);
                return this.published(earlier);
            }
            if (!this.uploads.has(stagingId)) {
                throw new ArtifactError('upload-incomplete', 'Nothing of this upload arrived; send the files first');
            }
            const sizes = await this.store.stagedSizes(stagingId);
            const complete = sizes.size === input.files.length && input.files.every((file, index) => sizes.get(index) === file.size);
            if (!complete) {
                throw new ArtifactError('upload-incomplete', 'The files that arrived differ from the ones named; send them again from where they stopped');
            }
            const first = input.files[0]!;
            const provenance = await this.deps.provenanceOf(caller);
            this.uploads.delete(stagingId);
            const committed = await this.store.commit(stagingId, {
                projectId,
                projectName: project.name,
                title: input.title ?? titleOf(basename(first.name)),
                ...(input.kind === undefined ? {} : { kind: input.kind }),
                ...(input.key === undefined ? {} : { key: input.key }),
                requestId: input.requestId,
                provenance,
                names: input.files.map((file) => file.name)
            });
            return this.published(committed);
        });
    }

    /*
     * A version the machine makes itself, such as the output of a routine's command: the bytes are its
     * own and so is the provenance, which no agent passes in. The same request id lands once.
     */
    async deliver(input: DeliverInput): Promise<CommitResult> {
        const project = await this.requireProject(input.projectId);
        const earlier = this.store.findRequest(input.projectId, input.requestId);
        if (earlier) {
            return earlier;
        }
        const bytes = input.files.reduce((sum, file) => sum + file.bytes.byteLength, 0);
        const stage = async (stagingId: string): Promise<void> => {
            for (const [index, file] of input.files.entries()) {
                await this.store.stageAppend(stagingId, index, file.bytes);
            }
        };
        return this.store.saveNew(bytes, stage, {
            projectId: input.projectId,
            projectName: project.name,
            title: input.title,
            ...(input.kind === undefined ? {} : { kind: input.kind }),
            key: input.key,
            requestId: input.requestId,
            provenance: input.provenance,
            names: input.files.map((file) => file.name)
        });
    }

    /* Copies a version into a project folder without replacing anything, and notes where it went. */
    async copyToProject(payload: ArtifactCopyToProjectPayload): Promise<string[]> {
        const project = await this.requireProject(payload.projectId);
        const found = this.store.get(payload.artifactId)?.versions.find((version) => version.versionId === payload.versionId);
        if (!found) {
            throw new ArtifactError('not-found', 'No such version on this machine');
        }
        const sources = found.files.map((file, index) => ({ file, path: this.store.file(payload.artifactId, payload.versionId, index)!.path }));
        const paths = await copyVersionInto(project.folder, payload.path, sources);
        await this.store.markCopied(payload.artifactId, payload.versionId, paths[0]!);
        return paths;
    }

    async storage(): Promise<ArtifactStorageResult> {
        const byProject = new Map<string, ArtifactProjectStorage>();
        const total = { artifacts: 0, versions: 0, bytes: 0 };
        for (const { artifact, versions } of this.store.all()) {
            const bytes = versions.reduce((sum, version) => sum + version.bytes, 0);
            const row = byProject.get(artifact.projectId) ?? {
                projectId: artifact.projectId,
                projectName: artifact.projectName,
                artifacts: 0,
                versions: 0,
                bytes: 0
            };
            row.artifacts++;
            row.versions += versions.length;
            row.bytes += bytes;
            byProject.set(artifact.projectId, row);
            total.artifacts++;
            total.versions += versions.length;
            total.bytes += bytes;
        }
        const names = await this.projectNames();
        const projects = [...byProject.values()].map((row) => this.named(names, row));
        return { projects: projects.sort((a, b) => b.bytes - a.bytes), total, disk: await this.store.volume() };
    }

    /*
     * A file of an artifact of one project, its text when it is text: an artifact of another project
     * answers as one that is not there. Without a version the latest, without an index the first file.
     */
    async read(projectId: string, query: { artifactId: string; versionId?: string; file?: number }): Promise<ArtifactReading> {
        const found = this.store.get(query.artifactId);
        if (!found || found.artifact.projectId !== projectId) {
            throw new ArtifactError('not-found', 'No such artifact in this project');
        }
        const version = query.versionId === undefined ? found.versions[0]! : found.versions.find((candidate) => candidate.versionId === query.versionId);
        if (!version) {
            throw new ArtifactError('not-found', 'No such version of this artifact');
        }
        const index = query.file ?? 0;
        const file = version.files[index];
        if (!file) {
            throw new ArtifactError('not-found', `This version holds ${version.files.length} files, counted from 0`);
        }
        const artifact = this.named(await this.projectNames(), found.artifact);
        if (!isTextMime(file.mime)) {
            return { artifact, version, file, text: null, truncated: false };
        }
        const start = (await this.store.readStart(query.artifactId, version.versionId, index, MAX_READ_BYTES)) ?? new Uint8Array();
        // A cut inside a character reads as one replacement character at the end, which is all a cut costs.
        return { artifact, version, file, text: new TextDecoder().decode(start), truncated: file.size > MAX_READ_BYTES };
    }

    /* One artifact of one project; an artifact of another project answers as one that is not there. */
    async getIn(projectId: string, artifactId: string): Promise<ArtifactGetResult> {
        if (this.store.get(artifactId)?.artifact.projectId !== projectId) {
            throw new ArtifactError('not-found', 'No such artifact in this project');
        }
        return this.get(artifactId);
    }

    /* A piece of a file of an artifact of one project, as base64, with the size of the whole file. */
    async readPiece(
        projectId: string,
        query: { artifactId: string; versionId: string; file: number; offset: number; length: number }
    ): Promise<{ size: number; offset: number; data: string }> {
        const found = this.store.get(query.artifactId);
        const file =
            found?.artifact.projectId === projectId ? found.versions.find((version) => version.versionId === query.versionId)?.files[query.file] : undefined;
        if (file === undefined) {
            throw new ArtifactError('not-found', 'No such file of an artifact in this project');
        }
        if (query.offset > file.size) {
            throw new ArtifactError('bad-path', `This file holds ${file.size} bytes`);
        }
        const bytes = await this.store.readRange(
            query.artifactId,
            query.versionId,
            query.file,
            query.offset,
            Math.min(query.length, PEER_ARTIFACT_PIECE_BYTES)
        );
        return { size: file.size, offset: query.offset, data: Buffer.from(bytes ?? new Uint8Array()).toString('base64') };
    }

    cleanupPreview(): ArtifactCleanupProposal[] {
        return cleanupProposals(this.store.all(), this.pinned());
    }

    /* Removes exactly what a person confirmed, minus anything that may not go by now. */
    cleanupConfirm(versions: readonly ArtifactVersionRef[]): Promise<{ removed: number; freedBytes: number }> {
        const pinned = this.pinned();
        return this.store.removeVersions(versions, (artifact, version) => removable(artifact, version, pinned));
    }

    /* A person's removal of an artifact or some of its versions; a copy in a project stays where it is. */
    remove(payload: ArtifactRemovePayload): Promise<ArtifactRemoveResult> {
        return this.store.remove(payload.artifactId, payload.versionIds);
    }

    private published(result: CommitResult): { result: CommitResult; artifact: Artifact; version: ArtifactVersion } {
        const found = this.store.get(result.artifactId)!;
        return { result, artifact: found.artifact, version: found.versions.find((version) => version.versionId === result.versionId)! };
    }

    private async dropUpload(stagingId: string): Promise<void> {
        this.uploads.delete(stagingId);
        await this.store.discardStaging(stagingId).catch(() => undefined);
    }

    /* One staging folder per session and upload id, so two sessions never write into each other's. */
    private stagingIdFor(caller: string, upload: string): string {
        return `up-${createHash('sha256').update(`${caller}\0${upload}`).digest('hex').slice(0, 32)}`;
    }

    private requireCallerProject(caller: string): string {
        const projectId = this.deps.projects.projectOf(caller);
        if (projectId === null) {
            throw new ArtifactError('not-found', 'This session is not a node or a view of any project on this machine');
        }
        return projectId;
    }

    private async requireProject(projectId: string): Promise<{ name: string; folder: string }> {
        const project = (await this.deps.projects.known()).find((candidate) => candidate.projectId === projectId);
        if (!project) {
            throw new ArtifactError('not-found', 'No such project on this machine');
        }
        return project;
    }

    /* The name each project has now; one an artifact outlived keeps the name it had. */
    private async projectNames(): Promise<Map<string, string>> {
        return new Map((await this.deps.projects.known()).map((project) => [project.projectId, project.name]));
    }

    private named<T extends Artifact | ArtifactProjectStorage>(names: ReadonlyMap<string, string>, row: T): T {
        const name = names.get(row.projectId);
        return name === undefined || name === row.projectName ? row : { ...row, projectName: name };
    }

    /* The file behind what a person saves, with the name, title and kind it suggests. */
    private async sourceFile(
        source: ArtifactSavePayload['source'],
        folder: string
    ): Promise<{ path: string; name: string; title: string; kind?: ArtifactKind }> {
        if (source.kind === 'image') {
            const path = await this.checkImage(source.path, folder);
            const name = labelOf(basename(path), 'image.png');
            return { path, name, title: titleOf(name), kind: 'image' };
        }
        const id = source.kind === 'visual' ? source.visualId : source.attachmentId;
        const attachment = await this.deps.chats.findAttachment(source.chatId, id);
        const page = attachment?.mime === 'text/html';
        if (!attachment || (source.kind === 'visual') !== page) {
            throw new ArtifactError('not-found', source.kind === 'visual' ? 'No such visual in that chat' : 'No such attachment in that chat');
        }
        const name = labelOf(attachment.name, page ? 'page.html' : 'attachment');
        return { path: attachment.path, name, title: titleOf(name), ...(page ? { kind: 'page' as const } : {}) };
    }

    /*
     * A picture a tool row shows: inside the project folder or the folders the machine keeps shots
     * in, judged on its real path, never a link, never the machine's own state, and an image by its bytes.
     */
    private async checkImage(path: string, folder: string): Promise<string> {
        const resolved = resolve(folder, path);
        await this.deps.machineHome.refuse(resolved);
        const info = await lstat(resolved).catch(() => null);
        if (info === null || info.isSymbolicLink() || !info.isFile()) {
            throw new ArtifactError(info?.isSymbolicLink() === true ? 'symlink' : 'not-found', 'That picture is not a file this machine saves');
        }
        const real = await realpath(resolved);
        const roots = await Promise.all([folder, ...shotFolders(this.deps.home)].map(realOrNull));
        if (!roots.some((root) => root !== null && isInside(root, real))) {
            throw new ArtifactError('outside-project', 'Only a picture inside the project folder or one the machine took for a chat is saved');
        }
        const head = new Uint8Array(await Bun.file(real).slice(0, SNIFF_HEAD_BYTES).arrayBuffer());
        const mime = sniffMime(head, info.size);
        if (mime === null || !mime.startsWith('image/')) {
            throw new ArtifactError('not-an-image', 'That file is no image by its bytes');
        }
        return real;
    }

    private changed(event: ArtifactChangedEvent): void {
        this.sinks.emit({ event: 'artifact.changed', payload: event });
    }
}

/*
 * The regular files under a folder in name order, each named by its path inside it with `/`. A link and
 * a dot file are left out; a folder holding more files than a version takes is refused rather than cut short.
 */
async function filesUnder(root: string, limit: number): Promise<{ path: string; name: string; size: number }[]> {
    const found: { path: string; name: string; size: number }[] = [];
    const walk = async (folder: string): Promise<void> => {
        const entries = await readdir(folder, { withFileTypes: true });
        entries.sort((one, other) => one.name.localeCompare(other.name));
        for (const entry of entries) {
            if (entry.name.startsWith('.') || entry.isSymbolicLink()) {
                continue;
            }
            const path = join(folder, entry.name);
            if (entry.isDirectory()) {
                await walk(path);
            } else if (entry.isFile()) {
                if (found.length >= limit) {
                    throw new ArtifactError('too-large', `A version holds at most ${limit} files`);
                }
                found.push({ path, name: relative(root, path).split(/[\\/]/).join('/'), size: (await lstat(path)).size });
            }
        }
    };
    await walk(root);
    return found;
}
