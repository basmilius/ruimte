import { randomBytes } from 'node:crypto';
import { join } from 'node:path';
import { Serializer } from '@adecore/utils/async';
import {
    ARTIFACT_LIMITS,
    ArtifactRequestIdSchema,
    ArtifactSchema,
    ArtifactVersionSchema,
    type Artifact,
    type ArtifactChangedEvent,
    type ArtifactFile,
    type ArtifactKind,
    type ArtifactOrigin,
    type ArtifactProvenance,
    type ArtifactSummary,
    type ArtifactVersion,
    type ArtifactVersionRef
} from '@ruimte/contracts';
import { z } from 'zod';
import { bestEffort } from '../best-effort.ts';
import { isDiskFull, NODE_ARTIFACT_FS, type ArtifactFs } from './artifact-fs.ts';
import { ArtifactError, checkFileName, checkKey, kindOf, mimeOf, SNIFF_HEAD_BYTES } from './artifact-names.ts';

const REGISTER_FILE = 'register.json';
const STAGING_FOLDER = '.staging';
const ARTIFACT_FILE = 'artifact.json';
const MANIFEST_FILE = 'manifest.json';
const FILES_FOLDER = 'files';

// Room the disk keeps past a save, so a full Output never leaves the machine itself without space.
export const DISK_MARGIN_BYTES = 64 * 1024 * 1024;

/* A version as its folder holds it: the request it answered stays on the machine. */
const ManifestSchema = ArtifactVersionSchema.extend({ requestId: ArtifactRequestIdSchema });
type Manifest = z.infer<typeof ManifestSchema>;

const RegisterSchema = z.object({
    version: z.literal(1),
    artifacts: z.array(z.object({ artifact: ArtifactSchema, versions: z.array(ManifestSchema) }))
});
type Register = z.infer<typeof RegisterSchema>;

interface Entry {
    artifact: Artifact;
    // Oldest first.
    versions: Manifest[];
}

export interface CommitInput {
    projectId: string;
    projectName: string;
    title: string;
    /* Absent, the kind of a new artifact is read off its first file; a new version keeps the artifact's. */
    kind?: ArtifactKind;
    key?: string;
    requestId: string;
    provenance: ArtifactProvenance;
    /* The name of each staged file, in the order they were staged. */
    names: readonly string[];
    origin?: ArtifactOrigin;
}

export interface CommitResult {
    artifactId: string;
    versionId: string;
    /* True when the request had already been saved and this is that version. */
    existing: boolean;
}

interface ArtifactStoreDeps {
    /* `$RUIMTE_HOME/artifacts`. */
    root: string;
    fs?: ArtifactFs;
    now?: () => number;
    /* A fresh id of lowercase letters and digits. */
    newId?: () => string;
}

interface ArtifactFilter {
    projectId?: string;
    chatId?: string;
}

function randomId(): string {
    return randomBytes(10).toString('hex');
}

function totalOf(versions: readonly Manifest[]): number {
    return versions.reduce((sum, version) => sum + version.bytes, 0);
}

function publicVersion(manifest: Manifest): ArtifactVersion {
    const { requestId: _requestId, ...version } = manifest;
    return version;
}

function parsed<T>(schema: z.ZodType<T>, text: string | null): T | null {
    if (text === null) {
        return null;
    }
    try {
        const result = schema.safeParse(JSON.parse(text));
        return result.success ? result.data : null;
    } catch {
        return null;
    }
}

export function versionTooLarge(): ArtifactError {
    return new ArtifactError('too-large', 'A version holds at most 2 GiB');
}

/* What a failure during a save says; a full disk is its own refusal, and a message never names a file. */
function saveFailure(e: unknown): unknown {
    if (isDiskFull(e)) {
        return new ArtifactError('disk-full', 'The disk is full; the version was not saved and older versions are untouched');
    }
    return e;
}

/*
 * The artifacts of this machine under `$RUIMTE_HOME/artifacts`: a folder per artifact, a folder per
 * version renamed into place whole from `.staging`, and `register.json` as the index of what the
 * folders hold. The folders are the truth: at every start the register is rebuilt from them, so a
 * save a stop cut short is either a whole version or nothing.
 */
export class ArtifactStore {
    readonly root: string;
    private readonly fs: ArtifactFs;
    private readonly now: () => number;
    private readonly newId: () => string;
    private readonly entries = new Map<string, Entry>();
    private readonly writes = new Serializer();
    private readonly listeners = new Set<(event: ArtifactChangedEvent) => void>();

    constructor(deps: ArtifactStoreDeps) {
        this.root = deps.root;
        this.fs = deps.fs ?? NODE_ARTIFACT_FS;
        this.now = deps.now ?? Date.now;
        this.newId = deps.newId ?? randomId;
    }

    /* Clears what a stop left in staging and rebuilds the register from the version folders there are. */
    async load(): Promise<void> {
        await this.fs.mkdir(this.root);
        await this.fs.remove(join(this.root, STAGING_FOLDER));
        this.entries.clear();
        for (const name of await this.fs.list(this.root)) {
            if (!/^art-[a-z0-9]{8,32}$/.test(name)) {
                continue;
            }
            const entry = await this.readEntry(name);
            if (entry === null) {
                // An artifact whose first version never landed: nothing of it was ever visible.
                await this.fs.remove(join(this.root, name));
                continue;
            }
            this.entries.set(name, entry);
        }
        const register = this.registerText();
        if ((await this.fs.readText(join(this.root, REGISTER_FILE))) !== register) {
            await this.fs.writeDurable(join(this.root, REGISTER_FILE), register);
        }
    }

    onChange(listener: (event: ArtifactChangedEvent) => void): () => void {
        this.listeners.add(listener);
        return () => {
            this.listeners.delete(listener);
        };
    }

    list(filter: ArtifactFilter = {}): ArtifactSummary[] {
        const summaries: ArtifactSummary[] = [];
        for (const entry of this.entries.values()) {
            if (filter.projectId !== undefined && entry.artifact.projectId !== filter.projectId) {
                continue;
            }
            if (filter.chatId !== undefined && !entry.versions.some((version) => version.provenance.chatId === filter.chatId)) {
                continue;
            }
            summaries.push(this.summaryOf(entry));
        }
        return summaries.sort((a, b) => b.latest.createdAt - a.latest.createdAt);
    }

    /* Newest version first; null for an id the register does not hold. */
    get(artifactId: string): { artifact: Artifact; versions: ArtifactVersion[] } | null {
        const entry = this.entries.get(artifactId);
        if (!entry) {
            return null;
        }
        return { artifact: entry.artifact, versions: entry.versions.map(publicVersion).reverse() };
    }

    /* The file at a place in a version's manifest, found by its ids in the register only. */
    file(artifactId: string, versionId: string, index: number): { path: string; file: ArtifactFile } | null {
        const version = this.entries.get(artifactId)?.versions.find((candidate) => candidate.versionId === versionId);
        const file = version?.files[index];
        if (!version || !file) {
            return null;
        }
        return { path: join(this.versionFolder(artifactId, versionId), FILES_FOLDER, String(index)), file };
    }

    /* The version an earlier save with this request id made in the project; null when there is none. */
    findRequest(projectId: string, requestId: string): CommitResult | null {
        for (const entry of this.entries.values()) {
            if (entry.artifact.projectId !== projectId) {
                continue;
            }
            const version = entry.versions.find((candidate) => candidate.requestId === requestId);
            if (version) {
                return { artifactId: entry.artifact.artifactId, versionId: version.versionId, existing: true };
            }
        }
        return null;
    }

    /* A new folder in staging, which a commit renames into place and nothing else ever reads. */
    async openStaging(stagingId = `sv-${this.newId()}`): Promise<string> {
        await this.fs.mkdir(this.stagedFiles(stagingId));
        return stagingId;
    }

    stagedFile(stagingId: string, index: number): string {
        return join(this.stagedFiles(stagingId), String(index));
    }

    async stagedSizes(stagingId: string): Promise<Map<number, number>> {
        const sizes = new Map<number, number>();
        for (const name of await this.fs.list(this.stagedFiles(stagingId))) {
            const index = Number(name);
            const size = Number.isInteger(index) && String(index) === name ? await this.fs.sizeOf(join(this.stagedFiles(stagingId), name)) : null;
            if (size !== null) {
                sizes.set(index, size);
            }
        }
        return sizes;
    }

    discardStaging(stagingId: string): Promise<void> {
        return this.fs.remove(join(this.root, STAGING_FOLDER, stagingId));
    }

    /* Refuses a save the disk has no room for, with the margin the machine keeps for itself. */
    async ensureRoom(bytes: number): Promise<void> {
        const volume = await this.fs.volume(this.root);
        if (volume !== null && volume.free < bytes + DISK_MARGIN_BYTES) {
            throw new ArtifactError('disk-full', 'The disk is too full to save this; older versions are untouched');
        }
    }

    /* Copies a file from elsewhere on the machine into staging as the next file. */
    async stageCopy(stagingId: string, index: number, from: string): Promise<void> {
        try {
            await this.fs.copyIn(from, this.stagedFile(stagingId, index));
        } catch (e) {
            throw saveFailure(e);
        }
    }

    /* Appends bytes to a staged file; the caller checked the offset and the limits. */
    async stageAppend(stagingId: string, index: number, bytes: Uint8Array): Promise<void> {
        try {
            await this.fs.append(this.stagedFile(stagingId, index), bytes);
        } catch (e) {
            throw saveFailure(e);
        }
    }

    /*
     * Turns what is staged into a version: hashed and flushed, its manifest beside it, then one rename
     * into the artifact's folder and the register written after. A request saved before answers that
     * version and the staging goes, so a retry lands once. A failure before the rename leaves nothing.
     */
    async commit(stagingId: string, input: CommitInput): Promise<CommitResult> {
        try {
            return await this.commitStaged(stagingId, input);
        } catch (e) {
            await bestEffort('discardStaging', this.discardStaging(stagingId));
            throw saveFailure(e);
        }
    }

    /*
     * Stages a new version of `bytes` in all through `stage` and commits it; what was staged goes when a
     * step fails. A version past the limit, or one the disk has no room for, is refused before anything is written.
     */
    async saveNew(bytes: number, stage: (stagingId: string) => Promise<void>, input: CommitInput): Promise<CommitResult> {
        if (bytes > ARTIFACT_LIMITS.versionBytes) {
            throw versionTooLarge();
        }
        await this.ensureRoom(bytes);
        const stagingId = await this.openStaging();
        try {
            await stage(stagingId);
        } catch (e) {
            await bestEffort('discardStaging', this.discardStaging(stagingId));
            throw e;
        }
        return this.commit(stagingId, input);
    }

    /* Notes that a version was copied into a project, which keeps it out of every cleanup proposal. */
    markCopied(artifactId: string, versionId: string, path: string): Promise<void> {
        return this.writes.run(async () => {
            const entry = this.entries.get(artifactId);
            const index = entry?.versions.findIndex((candidate) => candidate.versionId === versionId) ?? -1;
            if (!entry || index === -1) {
                throw new ArtifactError('not-found', 'No such version on this machine');
            }
            const version = entry.versions[index]!;
            if (version.copiedTo.includes(path)) {
                return;
            }
            const next: Manifest = { ...version, copiedTo: [...version.copiedTo, path] };
            await this.fs.writeDurable(join(this.versionFolder(artifactId, versionId), MANIFEST_FILE), JSON.stringify(next, null, 2));
            entry.versions[index] = next;
            await this.writeRegister();
            this.emit({ artifactId, projectId: entry.artifact.projectId });
        });
    }

    /*
     * Removes exactly the versions named that `removable` lets go, and never an artifact's latest. Each
     * folder leaves through staging, so a stop halfway leaves it gone or whole, never half.
     */
    removeVersions(
        refs: readonly ArtifactVersionRef[],
        removable: (artifact: Artifact, version: ArtifactVersion) => boolean
    ): Promise<{ removed: number; freedBytes: number }> {
        return this.writes.run(async () => {
            let removed = 0;
            let freedBytes = 0;
            const changed = new Set<string>();
            const trash: string[] = [];
            for (const ref of refs) {
                const entry = this.entries.get(ref.artifactId);
                const index = entry?.versions.findIndex((candidate) => candidate.versionId === ref.versionId) ?? -1;
                if (!entry || index === -1 || index === entry.versions.length - 1) {
                    continue;
                }
                const version = entry.versions[index]!;
                if (!removable(entry.artifact, publicVersion(version))) {
                    continue;
                }
                const staged = await this.moveToTrash(this.versionFolder(ref.artifactId, ref.versionId));
                entry.versions.splice(index, 1);
                trash.push(staged);
                changed.add(ref.artifactId);
                removed++;
                freedBytes += version.bytes;
            }
            if (removed === 0) {
                return { removed, freedBytes };
            }
            await this.writeRegister();
            for (const staged of trash) {
                await bestEffort('discardStaging', this.discardStaging(staged));
            }
            for (const artifactId of changed) {
                this.emit({ artifactId, projectId: this.entries.get(artifactId)!.artifact.projectId });
            }
            return { removed, freedBytes };
        });
    }

    /*
     * Removes what a person confirmed: the named versions of an artifact, or all of it when none are
     * named or every version is. Unlike a cleanup this lets go of the latest, a copied or a pinned
     * version too. Each folder moves into staging first, so a stop leaves it gone or whole.
     */
    remove(artifactId: string, versionIds?: readonly string[]): Promise<{ removed: number; freedBytes: number }> {
        return this.writes.run(async () => {
            const entry = this.entries.get(artifactId);
            if (!entry) {
                throw new ArtifactError('not-found', 'No such artifact on this machine');
            }
            const named = versionIds === undefined ? null : new Set(versionIds);
            const going = named === null ? entry.versions : entry.versions.filter((version) => named.has(version.versionId));
            if (going.length === 0) {
                throw new ArtifactError('not-found', 'No such version on this machine');
            }
            const freedBytes = totalOf(going);
            const trash: string[] = [];
            const whole = going.length === entry.versions.length;
            if (whole) {
                trash.push(await this.moveToTrash(join(this.root, artifactId)));
                this.entries.delete(artifactId);
            } else {
                for (const version of going) {
                    trash.push(await this.moveToTrash(this.versionFolder(artifactId, version.versionId)));
                    entry.versions = entry.versions.filter((candidate) => candidate !== version);
                }
            }
            await this.writeRegister();
            for (const staged of trash) {
                await bestEffort('discardStaging', this.discardStaging(staged));
            }
            this.emit({ artifactId, projectId: entry.artifact.projectId, ...(whole ? { removed: true } : {}) });
            return { removed: going.length, freedBytes };
        });
    }

    /* Every artifact with all its versions, oldest version first; what storage and cleanup read. */
    all(): Array<{ artifact: Artifact; versions: ArtifactVersion[] }> {
        return [...this.entries.values()].map((entry) => ({ artifact: entry.artifact, versions: entry.versions.map(publicVersion) }));
    }

    volume(): Promise<{ free: number; size: number } | null> {
        return this.fs.volume(this.root);
    }

    /* At most `length` bytes from the start of a file of a version; null for one the register does not hold. */
    async readStart(artifactId: string, versionId: string, index: number, length: number): Promise<Uint8Array | null> {
        const found = this.file(artifactId, versionId, index);
        return found ? this.fs.readHead(found.path, length) : null;
    }

    /* At most `length` bytes of a file of a version from `offset` on; null for one the register does not hold. */
    async readRange(artifactId: string, versionId: string, index: number, offset: number, length: number): Promise<Uint8Array | null> {
        const found = this.file(artifactId, versionId, index);
        return found ? this.fs.readRange(found.path, offset, length) : null;
    }

    private async commitStaged(stagingId: string, input: CommitInput): Promise<CommitResult> {
        const names = input.names.map(checkFileName);
        if (input.key !== undefined) {
            checkKey(input.key);
        }
        if (names.length === 0 || names.length > ARTIFACT_LIMITS.filesPerVersion) {
            throw new ArtifactError('too-large', `A version holds 1 to ${ARTIFACT_LIMITS.filesPerVersion} files`);
        }
        const earlier = this.findRequest(input.projectId, input.requestId);
        if (earlier) {
            await this.discardStaging(stagingId);
            return earlier;
        }
        const files = await this.describeStaged(stagingId, names);
        const bytes = files.reduce((sum, file) => sum + file.size, 0);
        if (bytes > ARTIFACT_LIMITS.versionBytes) {
            throw versionTooLarge();
        }
        return this.writes.run(async () => {
            // Asked again under the lock: two retries of one request may both have reached this point.
            const again = this.findRequest(input.projectId, input.requestId);
            if (again) {
                await this.discardStaging(stagingId);
                return again;
            }
            // A copy from another machine joins the artifact earlier copies of the same one made here, and never one by key.
            const keyed =
                input.origin !== undefined
                    ? this.byOrigin(input.projectId, input.origin)
                    : input.key === undefined
                      ? this.republished(input.projectId, input.provenance, names[0]!)
                      : this.byKey(input.projectId, input.key);
            const artifactId = keyed?.artifact.artifactId ?? `art-${this.newId()}`;
            const versionId = `ver-${this.newId()}`;
            const createdAt = this.now();
            const artifact: Artifact = keyed
                ? { ...keyed.artifact, title: input.title, projectName: input.projectName }
                : {
                      artifactId,
                      projectId: input.projectId,
                      projectName: input.projectName,
                      title: input.title,
                      kind: input.kind ?? kindOf(files[0]!.mime),
                      ...(input.key === undefined ? {} : { key: input.key }),
                      createdAt
                  };
            const manifest: Manifest = {
                versionId,
                number: (keyed?.versions.at(-1)?.number ?? 0) + 1,
                createdAt,
                files,
                bytes,
                provenance: input.provenance,
                copiedTo: [],
                ...(input.origin === undefined ? {} : { origin: input.origin }),
                requestId: input.requestId
            };
            const staged = join(this.root, STAGING_FOLDER, stagingId);
            await this.fs.writeDurable(join(staged, MANIFEST_FILE), JSON.stringify(manifest, null, 2));
            await this.fs.syncDir(join(staged, FILES_FOLDER));
            const folder = join(this.root, artifactId);
            if (!keyed || keyed.artifact.title !== artifact.title || keyed.artifact.projectName !== artifact.projectName) {
                await this.fs.mkdir(folder);
                await this.fs.writeDurable(join(folder, ARTIFACT_FILE), JSON.stringify(artifact, null, 2));
            }
            await this.fs.rename(staged, this.versionFolder(artifactId, versionId));
            await this.fs.syncDir(folder);
            // From the rename on the version exists, whatever the register says; the next start registers it.
            const entry = keyed ?? { artifact, versions: [] };
            entry.artifact = artifact;
            entry.versions.push(manifest);
            this.entries.set(artifactId, entry);
            this.emit({ artifactId, projectId: input.projectId });
            await this.writeRegister();
            return { artifactId, versionId, existing: false };
        });
    }

    private async describeStaged(stagingId: string, names: readonly string[]): Promise<ArtifactFile[]> {
        const sizes = await this.stagedSizes(stagingId);
        if (sizes.size !== names.length || names.some((_name, index) => !sizes.has(index))) {
            throw new ArtifactError('upload-incomplete', `${names.length} files were named and ${sizes.size} arrived`);
        }
        const files: ArtifactFile[] = [];
        for (const [index, name] of names.entries()) {
            const path = this.stagedFile(stagingId, index);
            const digest = await this.fs.digest(path);
            await this.fs.syncFile(path);
            const head = await this.fs.readHead(path, SNIFF_HEAD_BYTES);
            files.push({ name, mime: mimeOf(name, head, digest.size), size: digest.size, sha256: digest.sha256 });
        }
        return files;
    }

    private byKey(projectId: string, key: string): Entry | undefined {
        return [...this.entries.values()].find((entry) => entry.artifact.projectId === projectId && entry.artifact.key === key);
    }

    /*
     * An agent that publishes the same file again from the same chat without a key means a new version of
     * what it published before, not a second artifact; another chat's file of that name stays its own.
     */
    private republished(projectId: string, provenance: ArtifactProvenance, firstName: string): Entry | undefined {
        if (provenance.maker !== 'agent' || provenance.chatId === undefined) {
            return undefined;
        }

        return [...this.entries.values()].find(
            (entry) =>
                entry.artifact.projectId === projectId &&
                entry.artifact.key === undefined &&
                entry.versions.at(-1)?.files[0]?.name === firstName &&
                entry.versions.some((version) => version.provenance.maker === 'agent' && version.provenance.chatId === provenance.chatId)
        );
    }

    private byOrigin(projectId: string, origin: ArtifactOrigin): Entry | undefined {
        return [...this.entries.values()].find(
            (entry) =>
                entry.artifact.projectId === projectId &&
                entry.versions.some((version) => version.origin?.machineId === origin.machineId && version.origin.artifactId === origin.artifactId)
        );
    }

    private summaryOf(entry: Entry): ArtifactSummary {
        return { ...entry.artifact, latest: publicVersion(entry.versions.at(-1)!), versionCount: entry.versions.length, totalBytes: totalOf(entry.versions) };
    }

    /* An artifact as its folder holds it, its versions whole only; null for one without any. */
    private async readEntry(artifactId: string): Promise<Entry | null> {
        const folder = join(this.root, artifactId);
        const artifact = parsed(ArtifactSchema, await this.fs.readText(join(folder, ARTIFACT_FILE)));
        if (artifact === null || artifact.artifactId !== artifactId) {
            return null;
        }
        const versions: Manifest[] = [];
        for (const name of await this.fs.list(folder)) {
            if (!/^ver-[a-z0-9]{8,32}$/.test(name)) {
                continue;
            }
            const manifest = parsed(ManifestSchema, await this.fs.readText(join(folder, name, MANIFEST_FILE)));
            if (manifest !== null && manifest.versionId === name && (await this.filesWhole(artifactId, manifest))) {
                versions.push(manifest);
            }
        }
        if (versions.length === 0) {
            return null;
        }
        versions.sort((a, b) => a.number - b.number);
        return { artifact, versions };
    }

    private async filesWhole(artifactId: string, manifest: Manifest): Promise<boolean> {
        for (const [index, file] of manifest.files.entries()) {
            const size = await this.fs.sizeOf(join(this.versionFolder(artifactId, manifest.versionId), FILES_FOLDER, String(index)));
            if (size !== file.size) {
                return false;
            }
        }
        return true;
    }

    private registerText(): string {
        const register: Register = {
            version: 1,
            artifacts: [...this.entries.values()]
                .sort((a, b) => a.artifact.createdAt - b.artifact.createdAt || a.artifact.artifactId.localeCompare(b.artifact.artifactId))
                .map((entry) => ({ artifact: entry.artifact, versions: entry.versions }))
        };
        return `${JSON.stringify(register, null, 2)}\n`;
    }

    private writeRegister(): Promise<void> {
        return this.fs.writeDurable(join(this.root, REGISTER_FILE), this.registerText());
    }

    /* Moves a folder into staging in one rename, which every start clears; answers its name there. */
    private async moveToTrash(folder: string): Promise<string> {
        const staged = `rm-${this.newId()}`;
        await this.fs.mkdir(join(this.root, STAGING_FOLDER));
        await this.fs.rename(folder, join(this.root, STAGING_FOLDER, staged));
        return staged;
    }

    private stagedFiles(stagingId: string): string {
        return join(this.root, STAGING_FOLDER, stagingId, FILES_FOLDER);
    }

    private versionFolder(artifactId: string, versionId: string): string {
        return join(this.root, artifactId, versionId);
    }

    private emit(event: ArtifactChangedEvent): void {
        for (const listener of this.listeners) {
            listener(event);
        }
    }
}
