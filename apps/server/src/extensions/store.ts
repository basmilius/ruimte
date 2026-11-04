import { createHash, randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { isNotFound } from '@adecore/utils/errors';
import { EXTENSION_API_VERSION, ExtensionManifestSchema, ExtensionPackSchema, isSafePackPath, type ExtensionManifest } from '@ruimte/contracts';
import { z } from 'zod';
import { errorText } from '../error-text.ts';

export class ExtensionPackError extends Error {
    readonly code: 'pack-unreadable' | 'pack-manifest' | 'pack-api' | 'pack-path' | 'extension-unknown' | 'store-damaged';

    constructor(code: ExtensionPackError['code'], message: string) {
        super(message);
        this.code = code;
    }
}

export interface StoredExtension {
    manifest: ExtensionManifest;
    hash: string;
    enabled: boolean;
    // The folder its `server/` and `manifest.json` are read from.
    folder: string;
    devFolder?: string;
    revision?: number;
}

/* An extension whose `current.json` or manifest could not be read, which runs nothing until it is fixed or removed. */
export interface DamagedExtension {
    id: string;
    error: string;
}

export function isDamaged(entry: StoredExtension | DamagedExtension): entry is DamagedExtension {
    return 'error' in entry;
}

const CurrentSchema = z.object({ hash: z.string().min(1), enabled: z.boolean() });
const LinksSchema = z.record(z.string(), z.string());
const IDS_FILE = 'installed.json';
const LINKS_FILE = 'dev-links.json';
// Beside the links, so a Ruimte that only knows `dev-links.json` still reads that one as it is.
const LINKS_OFF_FILE = 'dev-links-off.json';
// The `extension dev` run that set each dev link, by its token per folder, kept on disk so a restart of the machine keeps it too.
const LINK_OWNERS_FILE = 'dev-link-owners.json';
const IdsSchema = z.array(z.string());
// A token alone per id is the shape of before owners were kept per folder, read as a link no run owns.
const OwnersSchema = z
    .record(z.string(), z.union([z.record(z.string(), z.string()), z.string()]))
    .transform((owners) =>
        Object.fromEntries(Object.entries(owners).filter((entry): entry is [string, Record<string, string>] => typeof entry[1] !== 'string'))
    );

/*
 * Only a file that is not there is the fallback. One that cannot be read or is damaged refuses, so a change never
 * writes over it with only what it adds and loses every installation or link it held.
 */
async function readJson<T>(path: string, schema: z.ZodType<T>, fallback: T): Promise<T> {
    let text: string;

    try {
        text = await readFile(path, 'utf8');
    } catch (e) {
        if (isNotFound(e)) {
            return fallback;
        }

        throw new ExtensionPackError('store-damaged', `${path} could not be read: ${errorText(e)}`);
    }

    let value: unknown;

    try {
        value = JSON.parse(text);
    } catch {
        throw new ExtensionPackError('store-damaged', `${path} is no JSON. Fix or remove it first.`);
    }

    const parsed = schema.safeParse(value);

    if (!parsed.success) {
        throw new ExtensionPackError('store-damaged', `${path} is not what this Ruimte reads. Fix or remove it first.`);
    }

    return parsed.data;
}

/* How the store writes its JSON files, handed in so a test can fail one as a full disk would. */
export type ExtensionStoreWrite = (file: string, text: string) => Promise<void>;

const NODE_WRITE: ExtensionStoreWrite = (file, text) => writeFile(file, text);

/*
 * What a machine has installed, under `$RUIMTE_HOME/extensions`: every version of an extension in a
 * folder named after its hash, `current.json` naming the one in use, and `data/` that outlives them.
 * Only the owner writes here, and no client file request reads it (`fs/machine-home.ts`).
 */
export class ExtensionStore {
    private readonly root: string;
    private readonly revisions = new Map<string, number>();
    private readonly write: ExtensionStoreWrite;
    private changes: Promise<unknown> = Promise.resolve();

    constructor(home: string, write: ExtensionStoreWrite = NODE_WRITE) {
        this.root = join(home, 'extensions');
        this.write = write;
    }

    private async writeJson(path: string, value: unknown): Promise<void> {
        await mkdir(dirname(path), { recursive: true });

        const temporary = `${path}.${randomUUID()}.tmp`;

        try {
            await this.write(temporary, JSON.stringify(value, null, 2));
            await rename(temporary, path);
        } catch (e) {
            await rm(temporary, { force: true });

            throw e;
        }
    }

    /*
     * One change at a time, from read to rename: two windows that install at once would otherwise both read the old
     * `installed.json` and keep only one of them.
     */
    private change<Value>(work: () => Promise<Value>): Promise<Value> {
        const next = this.changes.then(work, work);

        this.changes = next.catch(() => undefined);

        return next;
    }

    dataFolder(id: string): string {
        return join(this.root, id, 'data');
    }

    logFile(id: string): string {
        return join(this.root, id, 'server.log');
    }

    private currentFile(id: string): string {
        return join(this.root, id, 'current.json');
    }

    private versionFolder(id: string, hash: string): string {
        return join(this.root, id, 'versions', hash);
    }

    private installedIds(): Promise<string[]> {
        return readJson(join(this.root, IDS_FILE), IdsSchema, []);
    }

    private links(): Promise<Record<string, string>> {
        return readJson(join(this.root, LINKS_FILE), LinksSchema, {});
    }

    /* The links a person turned off, which stay off over every save of `extension dev` until it ends. */
    private linksOff(): Promise<string[]> {
        return readJson(join(this.root, LINKS_OFF_FILE), IdsSchema, []);
    }

    private async writeLinksOff(id: string, off: boolean): Promise<void> {
        const ids = (await this.linksOff()).filter((entry) => entry !== id);

        await this.writeJson(join(this.root, LINKS_OFF_FILE), off ? [...ids, id] : ids);
    }

    private linkOwners(): Promise<Record<string, Record<string, string>>> {
        return readJson(join(this.root, LINK_OWNERS_FILE), OwnersSchema, {});
    }

    /* The run that owns the link of `id` as it is now: the owner its folder has, so one of another folder owns nothing. */
    private async linkOwner(id: string): Promise<string | undefined> {
        const [links, owners] = await Promise.all([this.links(), this.linkOwners()]);
        const folder = links[id];

        return folder === undefined ? undefined : owners[id]?.[folder];
    }

    private async dropLinkOwners(id: string): Promise<void> {
        const { [id]: _gone, ...owners } = await this.linkOwners();

        await this.writeJson(join(this.root, LINK_OWNERS_FILE), owners);
    }

    /*
     * One extension whose files cannot be read is listed with why, so the others still are and a person can remove it.
     * An index that cannot be read still refuses the whole list.
     */
    async list(): Promise<(StoredExtension | DamagedExtension)[]> {
        const [ids, links] = await Promise.all([this.installedIds(), this.links()]);
        const stored = await Promise.all(
            [...new Set([...ids, ...Object.keys(links)])].map((id) => this.get(id).catch((e: unknown): DamagedExtension => ({ id, error: errorText(e) })))
        );

        return stored.filter((entry) => entry !== null);
    }

    async get(id: string): Promise<StoredExtension | null> {
        const devFolder = (await this.links())[id];

        if (devFolder !== undefined) {
            const manifest = await this.manifestIn(devFolder);
            const revision = this.revisions.get(id) ?? 0;

            return manifest === null
                ? null
                : { manifest, hash: `dev-${revision}`, enabled: !(await this.linksOff()).includes(id), folder: devFolder, devFolder, revision };
        }

        const current = await this.current(id);

        if (current === null) {
            return null;
        }

        const folder = this.versionFolder(id, current.hash);
        const manifest = await this.manifestIn(folder);

        return manifest === null ? null : { manifest, hash: current.hash, enabled: current.enabled, folder };
    }

    /* A version or dev folder without a manifest has nothing to run; one that cannot be read or is damaged refuses. */
    private manifestIn(folder: string): Promise<ExtensionManifest | null> {
        return readJson<ExtensionManifest | null>(join(folder, 'manifest.json'), ExtensionManifestSchema as z.ZodType<ExtensionManifest | null>, null);
    }

    /* Refuses as the other files do, so an install never writes over a version in use, or its turn off, it could not read. */
    private current(id: string): Promise<z.infer<typeof CurrentSchema> | null> {
        return readJson(this.currentFile(id), CurrentSchema, null);
    }

    /*
     * A pack is checked whole before a byte is written, so a bad one leaves the version in use alone. Its files are
     * unpacked in the same change as the rest, so a removal never meets half of them, and land under a temporary name
     * first. `current.json` goes last: it is what makes the version the one in use.
     */
    async install(pack: string): Promise<StoredExtension> {
        const bytes = Buffer.from(pack, 'base64');
        const files = unpack(bytes);
        const manifest = manifestOf(files);
        const hash = createHash('sha256').update(bytes).digest('hex');
        const folder = this.versionFolder(manifest.id, hash);

        return this.change(async () => {
            // A folder of this hash holds exactly this pack, so one that cannot be read is unpacked again rather than refused.
            if ((await this.manifestIn(folder).catch(() => null)) === null) {
                const unpacking = `${folder}.${randomUUID()}.tmp`;

                try {
                    for (const [path, content] of Object.entries(files)) {
                        const target = join(unpacking, path);

                        await mkdir(dirname(target), { recursive: true });
                        await writeFile(target, content);
                    }

                    await rm(folder, { recursive: true, force: true });
                    await rename(unpacking, folder);
                } finally {
                    await rm(unpacking, { recursive: true, force: true });
                }
            }

            const previous = await this.current(manifest.id);
            const enabled = previous?.enabled ?? true;

            await this.writeJson(join(this.root, IDS_FILE), [...new Set([...(await this.installedIds()), manifest.id])]);
            await this.writeJson(this.currentFile(manifest.id), { hash, enabled });

            return { manifest, hash, enabled, folder };
        });
    }

    /* `data/` and a dev link go with it: a person who removes an extension means all of it. */
    remove(id: string): Promise<void> {
        return this.change(async () => {
            const ids = await this.installedIds();
            const { [id]: _gone, ...links } = await this.links();

            await this.writeJson(join(this.root, LINKS_FILE), links);
            await this.writeLinksOff(id, false);
            await this.writeJson(
                join(this.root, IDS_FILE),
                ids.filter((entry) => entry !== id)
            );
            await this.dropLinkOwners(id);
            await rm(join(this.root, id), { recursive: true, force: true });
        });
    }

    /* Of what runs: the dev link while there is one, and the installed version beside it, so neither turns on when the other ends. */
    setEnabled(id: string, enabled: boolean): Promise<void> {
        return this.change(async () => {
            const linked = (await this.links())[id] !== undefined;
            const current = await this.current(id);

            if (current === null && !linked) {
                throw new ExtensionPackError('extension-unknown', `No extension ${id} on this machine`);
            }

            if (linked) {
                await this.writeLinksOff(id, !enabled);
            }

            if (current !== null) {
                await this.writeJson(this.currentFile(id), { ...current, enabled });
            }
        });
    }

    /* A folder `ruimte extension dev` builds into. A save moves the revision, which is how a client knows to load it again. */
    async link(folder: string, owner?: string): Promise<ExtensionManifest> {
        const manifest = await this.manifestIn(folder).catch(() => null);

        if (manifest === null) {
            throw new ExtensionPackError('pack-manifest', `No valid manifest.json in ${folder}`);
        }

        if (manifest.api !== EXTENSION_API_VERSION) {
            throw new ExtensionPackError('pack-api', `${manifest.id} needs API ${manifest.api}; this machine has ${EXTENSION_API_VERSION}`);
        }

        return this.change(async () => {
            const { id } = manifest;
            const links = await this.links();
            const { [id]: previous = {}, ...owners } = await this.linkOwners();
            const linkedNow = links[id];
            const kept = linkedNow === undefined || linkedNow === folder || previous[linkedNow] === undefined ? {} : { [linkedNow]: previous[linkedNow] };
            const next = owner === undefined ? kept : { ...kept, [folder]: owner };

            // Who owns the new folder lands beside who owns the one linked now, and the link after it: a write that fails
            // leaves the link and its owner as they were, and the link is the one write that changes what runs. A link
            // of the folder linked now changes nothing in `dev-links.json`, so its owner is its one write.
            await this.writeJson(join(this.root, LINK_OWNERS_FILE), Object.keys(next).length === 0 ? owners : { ...owners, [id]: next });

            if (linkedNow !== folder) {
                await this.writeJson(join(this.root, LINKS_FILE), { ...links, [id]: folder });
            }

            this.revisions.set(id, (this.revisions.get(id) ?? 0) + 1);

            return manifest;
        });
    }

    /*
     * Whether it unlinked. With `owner`, only while the link is exactly that run's: a later `extension dev` of the same
     * extension took it over, or no run owns it. Checked in the same change as the write, so a link on its way lands
     * before or after it.
     */
    unlink(id: string, owner?: string): Promise<boolean> {
        return this.change(async () => {
            if (owner !== undefined && (await this.linkOwner(id)) !== owner) {
                return false;
            }

            const { [id]: _gone, ...rest } = await this.links();

            await this.writeJson(join(this.root, LINKS_FILE), rest);
            await this.writeLinksOff(id, false);
            await this.dropLinkOwners(id);

            return true;
        });
    }

    serverEntry(extension: StoredExtension): string | null {
        const entry = join(extension.folder, 'server', 'index.js');

        return existsSync(entry) ? entry : null;
    }
}

function unpack(bytes: Buffer): Record<string, Buffer> {
    let parsed: unknown;

    try {
        parsed = JSON.parse(gunzipSync(bytes).toString('utf8'));
    } catch {
        throw new ExtensionPackError('pack-unreadable', 'This is not an extension pack');
    }

    const pack = ExtensionPackSchema.safeParse(parsed);

    if (!pack.success) {
        throw new ExtensionPackError('pack-unreadable', 'This is not an extension pack');
    }

    return Object.fromEntries(
        Object.entries(pack.data.files).map(([path, content]) => {
            if (!isSafePackPath(path)) {
                throw new ExtensionPackError('pack-path', `The pack names a path outside itself: ${path}`);
            }

            return [path, Buffer.from(content, 'base64')];
        })
    );
}

/* What a pack installs as, checked whole, so a caller can order the install among the other changes of that id. */
export function manifestOfPack(pack: string): ExtensionManifest {
    return manifestOf(unpack(Buffer.from(pack, 'base64')));
}

function manifestOf(files: Record<string, Buffer>): ExtensionManifest {
    const raw = files['manifest.json'];
    const manifest = raw === undefined ? null : ExtensionManifestSchema.safeParse(JSON.parse(raw.toString('utf8')));

    if (manifest === null || !manifest.success) {
        throw new ExtensionPackError('pack-manifest', 'The pack has no valid manifest.json');
    }

    if (manifest.data.api !== EXTENSION_API_VERSION) {
        throw new ExtensionPackError('pack-api', `${manifest.data.id} needs API ${manifest.data.api}; this machine has ${EXTENSION_API_VERSION}`);
    }

    return manifest.data;
}
