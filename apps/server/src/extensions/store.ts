import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { EXTENSION_API_VERSION, ExtensionManifestSchema, ExtensionPackSchema, isSafePackPath, type ExtensionManifest } from '@ruimte/contracts';
import { z } from 'zod';

export class ExtensionPackError extends Error {
    readonly code: 'pack-unreadable' | 'pack-manifest' | 'pack-api' | 'pack-path' | 'extension-unknown';

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

const CurrentSchema = z.object({ hash: z.string().min(1), enabled: z.boolean() });
const LinksSchema = z.record(z.string(), z.string());
const IDS_FILE = 'installed.json';
const LINKS_FILE = 'dev-links.json';
const IdsSchema = z.array(z.string());

async function readJson<T>(path: string, schema: z.ZodType<T>, fallback: T): Promise<T> {
    try {
        return schema.parse(JSON.parse(await readFile(path, 'utf8')));
    } catch {
        return fallback;
    }
}

async function writeJson(path: string, value: unknown): Promise<void> {
    await mkdir(dirname(path), { recursive: true });

    const temporary = `${path}.tmp`;

    await writeFile(temporary, JSON.stringify(value, null, 2));
    await rename(temporary, path);
}

/*
 * What a machine has installed, under `$RUIMTE_HOME/extensions`: every version of an extension in a
 * folder named after its hash, `current.json` naming the one in use, and `data/` that outlives them.
 * Only the owner writes here, and no client file request reads it (`fs/machine-home.ts`).
 */
export class ExtensionStore {
    private readonly root: string;
    private readonly revisions = new Map<string, number>();

    constructor(home: string) {
        this.root = join(home, 'extensions');
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

    async list(): Promise<StoredExtension[]> {
        const [ids, links] = await Promise.all([this.installedIds(), this.links()]);
        const stored = await Promise.all([...new Set([...ids, ...Object.keys(links)])].map((id) => this.get(id)));

        return stored.filter((entry) => entry !== null);
    }

    async get(id: string): Promise<StoredExtension | null> {
        const devFolder = (await this.links())[id];

        if (devFolder !== undefined) {
            const manifest = await this.manifestIn(devFolder);

            return manifest === null
                ? null
                : { manifest, hash: `dev-${this.revisions.get(id) ?? 0}`, enabled: true, folder: devFolder, devFolder, revision: this.revisions.get(id) ?? 0 };
        }

        const current = await readJson(this.currentFile(id), CurrentSchema, null as never).catch(() => null);

        if (current === null) {
            return null;
        }

        const folder = this.versionFolder(id, current.hash);
        const manifest = await this.manifestIn(folder);

        return manifest === null ? null : { manifest, hash: current.hash, enabled: current.enabled, folder };
    }

    private async manifestIn(folder: string): Promise<ExtensionManifest | null> {
        return readJson<ExtensionManifest | null>(join(folder, 'manifest.json'), ExtensionManifestSchema as z.ZodType<ExtensionManifest | null>, null);
    }

    /* A pack is checked whole before a byte is written, so a bad one leaves the version in use alone. */
    async install(pack: string): Promise<StoredExtension> {
        const files = unpack(Buffer.from(pack, 'base64'));
        const manifest = manifestOf(files);
        const hash = createHash('sha256').update(Buffer.from(pack, 'base64')).digest('hex');
        const folder = this.versionFolder(manifest.id, hash);

        for (const [path, content] of Object.entries(files)) {
            const target = join(folder, path);

            await mkdir(dirname(target), { recursive: true });
            await writeFile(target, content);
        }

        const previous = await readJson(this.currentFile(manifest.id), CurrentSchema, null as never).catch(() => null);

        await writeJson(this.currentFile(manifest.id), { hash, enabled: previous?.enabled ?? true });
        await writeJson(join(this.root, IDS_FILE), [...new Set([...(await this.installedIds()), manifest.id])]);

        return { manifest, hash, enabled: previous?.enabled ?? true, folder };
    }

    /* `data/` goes with it: a person who removes an extension means all of it. */
    async remove(id: string): Promise<void> {
        await rm(join(this.root, id), { recursive: true, force: true });
        await writeJson(
            join(this.root, IDS_FILE),
            (await this.installedIds()).filter((entry) => entry !== id)
        );
    }

    async setEnabled(id: string, enabled: boolean): Promise<void> {
        const current = await readJson(this.currentFile(id), CurrentSchema, null as never).catch(() => null);

        if (current === null) {
            throw new ExtensionPackError('extension-unknown', `No extension ${id} on this machine`);
        }

        await writeJson(this.currentFile(id), { ...current, enabled });
    }

    /* A folder `ruimte extension dev` builds into. A save moves the revision, which is how a client knows to load it again. */
    async link(folder: string): Promise<ExtensionManifest> {
        const manifest = await this.manifestIn(folder);

        if (manifest === null) {
            throw new ExtensionPackError('pack-manifest', `No valid manifest.json in ${folder}`);
        }

        if (manifest.api !== EXTENSION_API_VERSION) {
            throw new ExtensionPackError('pack-api', `${manifest.id} needs API ${manifest.api}; this machine has ${EXTENSION_API_VERSION}`);
        }

        await writeJson(join(this.root, LINKS_FILE), { ...(await this.links()), [manifest.id]: folder });
        this.revisions.set(manifest.id, (this.revisions.get(manifest.id) ?? 0) + 1);

        return manifest;
    }

    async unlink(id: string): Promise<void> {
        const { [id]: _gone, ...rest } = await this.links();

        await writeJson(join(this.root, LINKS_FILE), rest);
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
