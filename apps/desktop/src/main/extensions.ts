import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, readFile, realpath, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, extname, join, normalize, sep } from 'node:path';
import { gunzipSync } from 'node:zlib';
import {
    EXTENSION_API_VERSION,
    EXTENSION_ICON_PATH,
    ExtensionManifestSchema,
    ExtensionPackSchema,
    isSafePackPath,
    type ExtensionManifest
} from '@ruimte/contracts';
import { EXTENSION_FILES_PATH, extensionFrameCsp } from '@ruimte/csp';
import type { InstalledClientExtension } from '@ruimte/desktop-bridge';
import { z } from 'zod';

const IndexSchema = z.array(z.object({ id: z.string(), hash: z.string(), enabled: z.boolean() }));
type IndexEntry = z.infer<typeof IndexSchema>[number];

const LOAD_MARK = /~\d+$/;

const MIME: Readonly<Record<string, string>> = {
    '.js': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.html': 'text/html; charset=utf-8',
    '.json': 'application/json',
    '.png': 'image/png',
    '.webp': 'image/webp',
    '.svg': 'image/svg+xml',
    '.woff2': 'font/woff2',
    '.wasm': 'application/wasm'
};

function hostsOf(manifest: ExtensionManifest): string[] {
    return Object.keys(manifest.permissions ?? {}).flatMap((permission) =>
        permission.startsWith('net:') ? [`https://${permission.slice('net:'.length)}`] : []
    );
}

/*
 * The client parts of extensions, under the shell's `userData`, served on the app's origin at
 * `/__extensions/<id>/<version>/` so a window can `import()` them under its own policy. A dev link reads
 * a folder instead. What the page asks for stays inside that one folder.
 */
export class ClientExtensions {
    private readonly root: string;
    private readonly links = new Map<string, { folder: string; revision: number; manifest: ExtensionManifest; enabled: boolean }>();
    private changes: Promise<unknown> = Promise.resolve();
    private temporaryCounter = 0;
    // Every window shares these installations, also one in machine mode `none` or on another machine, so each hears of a change.
    private readonly onChanged: () => void;

    constructor(root: string, onChanged: () => void = () => undefined) {
        this.root = root;
        this.onChanged = onChanged;
    }

    /* Only an index that is not there is empty: one that cannot be read refuses, so no change writes over what it held. */
    private async index(): Promise<IndexEntry[]> {
        let text: string;

        try {
            text = await readFile(join(this.root, 'index.json'), 'utf8');
        } catch (e) {
            if ((e as { code?: unknown }).code === 'ENOENT') {
                return [];
            }

            throw e;
        }

        const parsed = IndexSchema.safeParse(JSON.parse(text));

        if (!parsed.success) {
            throw new Error(`${join(this.root, 'index.json')} is not what this Ruimte reads. Fix or remove it first.`);
        }

        return parsed.data;
    }

    /*
     * One change of the installations at a time, from the first file it unpacks to the last it removes, and links
     * beside them: two windows that change one extension at once land in the order they asked.
     */
    private serial<T>(work: () => Promise<T>): Promise<T> {
        const next = this.changes.then(work, work);

        this.changes = next.catch(() => undefined);

        return next;
    }

    /*
     * `serial`, and word to every window as part of it once `work` called `touched`: what a window loads changed, also
     * when a later step of the change failed, and the next change only begins after the word went out.
     */
    private change<T>(work: (touched: () => void) => Promise<T>): Promise<T> {
        return this.serial(async () => {
            let touched = false;

            try {
                return await work(() => (touched = true));
            } finally {
                if (touched) {
                    this.onChanged();
                }
            }
        });
    }

    /* Inside `serial` only. */
    private async writeIndex(entries: IndexEntry[]): Promise<void> {
        await mkdir(this.root, { recursive: true });

        const temporary = join(this.root, `index.json.${process.pid}-${this.temporaryCounter++}.tmp`);

        try {
            await writeFile(temporary, JSON.stringify(entries));
            await rename(temporary, join(this.root, 'index.json'));
        } catch (e) {
            await rm(temporary, { force: true });
            throw e;
        }
    }

    private async manifestIn(folder: string): Promise<ExtensionManifest | null> {
        try {
            return ExtensionManifestSchema.parse(JSON.parse(await readFile(join(folder, 'manifest.json'), 'utf8')));
        } catch {
            return null;
        }
    }

    private installedOf(entry: IndexEntry, manifest: ExtensionManifest): InstalledClientExtension {
        return {
            manifest,
            base: `${EXTENSION_FILES_PATH}${entry.id}/${entry.hash}/`,
            enabled: entry.enabled,
            hasClient: existsSync(join(this.root, entry.id, entry.hash, 'client', 'index.js')),
            hasIcon: existsSync(join(this.root, entry.id, entry.hash, EXTENSION_ICON_PATH)),
            dev: false
        };
    }

    async list(): Promise<InstalledClientExtension[]> {
        const installed = await Promise.all(
            (await this.index()).map(async (entry) => {
                const manifest = await this.manifestIn(join(this.root, entry.id, entry.hash));

                return manifest === null || this.links.has(entry.id) ? [] : [this.installedOf(entry, manifest)];
            })
        );
        const linked = [...this.links.entries()].map(([id, link]) => ({
            manifest: link.manifest,
            base: `${EXTENSION_FILES_PATH}${id}/dev-${link.revision}/`,
            enabled: link.enabled,
            hasClient: existsSync(join(link.folder, 'client', 'index.js')),
            hasIcon: existsSync(join(link.folder, EXTENSION_ICON_PATH)),
            dev: true
        }));

        return [...installed.flat(), ...linked];
    }

    async install(pack: Uint8Array): Promise<InstalledClientExtension> {
        const bytes = Buffer.from(pack);
        const parsed = ExtensionPackSchema.parse(JSON.parse(gunzipSync(bytes).toString('utf8')));
        const paths = Object.keys(parsed.files);

        if (!paths.every(isSafePackPath)) {
            throw new Error('The pack names a path outside itself');
        }

        const manifest = ExtensionManifestSchema.parse(JSON.parse(Buffer.from(parsed.files['manifest.json'] ?? '', 'base64').toString('utf8')));

        if (manifest.api !== EXTENSION_API_VERSION) {
            throw new Error(`${manifest.name} needs a different version of Ruimte`);
        }

        const hash = createHash('sha256').update(bytes).digest('hex');
        const folder = join(this.root, manifest.id, hash);

        // Unpacked in the same change as the index, so a removal never meets half of it, and under a temporary name first.
        const entry = await this.change(async (touched) => {
            const entries = await this.index();

            if ((await this.manifestIn(folder)) === null) {
                const unpacking = `${folder}.${process.pid}-${this.temporaryCounter++}.tmp`;

                try {
                    for (const path of paths) {
                        await mkdir(dirname(join(unpacking, path)), { recursive: true });
                        await writeFile(join(unpacking, path), Buffer.from(parsed.files[path] as string, 'base64'));
                    }

                    await rm(folder, { recursive: true, force: true });
                    await rename(unpacking, folder);
                } finally {
                    await rm(unpacking, { recursive: true, force: true });
                }
            }

            const added = { id: manifest.id, hash, enabled: entries.find((each) => each.id === manifest.id)?.enabled ?? true };

            await this.writeIndex([...entries.filter((each) => each.id !== manifest.id), added]);
            touched();

            return added;
        });

        return this.installedOf(entry, manifest);
    }

    /*
     * A dev link of the id goes with it, or the folder it reads would run on as before. Only once the index is written,
     * so a write that fails leaves every window's list as it was.
     */
    remove(id: string): Promise<void> {
        return this.change(async (touched) => {
            await this.writeIndex((await this.index()).filter((entry) => entry.id !== id));
            this.links.delete(id);
            touched();
            await rm(join(this.root, id), { recursive: true, force: true });
        });
    }

    /*
     * A dev link of the id is turned on or off with it, and keeps that through its next builds. Only once the index is
     * written, so a write that fails turns nothing a window was not told of.
     */
    setEnabled(id: string, enabled: boolean): Promise<void> {
        return this.change(async (touched) => {
            await this.writeIndex((await this.index()).map((entry) => (entry.id === id ? { ...entry, enabled } : entry)));

            const link = this.links.get(id);

            if (link !== undefined) {
                this.links.set(id, { ...link, enabled });
            }

            touched();
        });
    }

    /* In the order windows asked, so an unlink or a newer link while the manifest is read is never undone by it. */
    link(folder: string, revision: number): Promise<void> {
        return this.change(async (touched) => {
            const manifest = await this.manifestIn(folder);

            if (manifest === null) {
                throw new Error(`No valid manifest.json in ${folder}`);
            }

            this.links.set(manifest.id, { folder, revision, manifest, enabled: this.links.get(manifest.id)?.enabled ?? true });
            touched();
        });
    }

    unlink(id: string): Promise<void> {
        return this.change(async (touched) => {
            if (this.links.delete(id)) {
                touched();
            }
        });
    }

    private async folderOf(id: string, version: string): Promise<{ folder: string; manifest: ExtensionManifest } | null> {
        const link = this.links.get(id);

        if (link !== undefined && version === `dev-${link.revision}`) {
            return { folder: link.folder, manifest: link.manifest };
        }

        if (!(await this.index()).some((entry) => entry.id === id && entry.hash === version)) {
            return null;
        }

        const folder = join(this.root, id, version);
        const manifest = await this.manifestIn(folder);

        return manifest === null ? null : { folder, manifest };
    }

    /* A file of an extension, for the app scheme. An html file is a frame, with the policy its manifest allows. */
    async answer(pathname: string, origin: string): Promise<Response> {
        let parts: string[];

        try {
            parts = pathname.slice(EXTENSION_FILES_PATH.length).split('/').map(decodeURIComponent);
        } catch {
            return new Response('Bad request', { status: 400 });
        }

        const [id, asked, ...rest] = parts;
        // A window asks each load of a version under `<version>~<load>`, so its modules run anew; the files are the version's.
        const version = asked?.replace(LOAD_MARK, '');
        const relative = rest.join('/');

        if (id === undefined || version === undefined || !isSafePackPath(relative)) {
            return new Response('Not found', { status: 404 });
        }

        const found = await this.folderOf(id, version).catch(() => null);

        if (found === null) {
            return new Response('Not found', { status: 404 });
        }

        const path = normalize(join(found.folder, relative));

        if (!path.startsWith(`${normalize(found.folder)}${sep}`)) {
            return new Response('Not found', { status: 404 });
        }

        try {
            const [real, folder] = await Promise.all([realpath(path), realpath(found.folder)]);

            // A symlink in a dev folder would otherwise hand a sandboxed frame any file this person can read.
            if (!real.startsWith(`${folder}${sep}`)) {
                return new Response('Not found', { status: 404 });
            }

            const extension = extname(path);
            const headers: Record<string, string> = {
                'content-type': MIME[extension] ?? 'application/octet-stream',
                'x-content-type-options': 'nosniff',
                'cache-control': 'no-cache',
                'access-control-allow-origin': '*'
            };

            if (extension === '.html') {
                headers['content-security-policy'] = extensionFrameCsp(origin, hostsOf(found.manifest));
            }

            return new Response(await readFile(real), { headers });
        } catch {
            return new Response('Not found', { status: 404 });
        }
    }
}
