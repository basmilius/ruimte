import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
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
    private readonly links = new Map<string, { folder: string; revision: number; manifest: ExtensionManifest }>();

    constructor(root: string) {
        this.root = root;
    }

    private async index(): Promise<IndexEntry[]> {
        try {
            return IndexSchema.parse(JSON.parse(await readFile(join(this.root, 'index.json'), 'utf8')));
        } catch {
            return [];
        }
    }

    private async writeIndex(entries: IndexEntry[]): Promise<void> {
        await mkdir(this.root, { recursive: true });

        const temporary = join(this.root, 'index.json.tmp');

        await writeFile(temporary, JSON.stringify(entries));
        await rename(temporary, join(this.root, 'index.json'));
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
            enabled: true,
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

        for (const path of paths) {
            await mkdir(dirname(join(folder, path)), { recursive: true });
            await writeFile(join(folder, path), Buffer.from(parsed.files[path] as string, 'base64'));
        }

        const entries = await this.index();
        const entry = { id: manifest.id, hash, enabled: entries.find((each) => each.id === manifest.id)?.enabled ?? true };

        await this.writeIndex([...entries.filter((each) => each.id !== manifest.id), entry]);

        return this.installedOf(entry, manifest);
    }

    async remove(id: string): Promise<void> {
        await this.writeIndex((await this.index()).filter((entry) => entry.id !== id));
        await rm(join(this.root, id), { recursive: true, force: true });
    }

    async setEnabled(id: string, enabled: boolean): Promise<void> {
        await this.writeIndex((await this.index()).map((entry) => (entry.id === id ? { ...entry, enabled } : entry)));
    }

    async link(folder: string, revision: number): Promise<void> {
        const manifest = await this.manifestIn(folder);

        if (manifest === null) {
            throw new Error(`No valid manifest.json in ${folder}`);
        }

        this.links.set(manifest.id, { folder, revision, manifest });
    }

    unlink(id: string): void {
        this.links.delete(id);
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
        const [id, version, ...rest] = pathname.slice(EXTENSION_FILES_PATH.length).split('/').map(decodeURIComponent);
        const relative = rest.join('/');

        if (id === undefined || version === undefined || !isSafePackPath(relative)) {
            return new Response('Not found', { status: 404 });
        }

        const found = await this.folderOf(id, version);

        if (found === null) {
            return new Response('Not found', { status: 404 });
        }

        const path = normalize(join(found.folder, relative));

        if (!path.startsWith(`${normalize(found.folder)}${sep}`)) {
            return new Response('Not found', { status: 404 });
        }

        try {
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

            return new Response(await readFile(path), { headers });
        } catch {
            return new Response('Not found', { status: 404 });
        }
    }
}
