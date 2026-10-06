import release from './php-native-release.json' with { type: 'json' };
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, realpathSync } from 'node:fs';
import { access, mkdir, mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import type { LanguageServerKind } from '@ruimte/contracts';
import { extractEntries, readArchive, type ArchiveFormat } from './archive.ts';

/* A kind whose server is a program of its own, downloaded or built once, and not an npm package. */
export type NativeKind = 'php-native';

export function isNativeKind(kind: LanguageServerKind): kind is NativeKind {
    return kind === 'php-native';
}

/* One download of a release: the archive for a platform and architecture. */
export interface NativeAsset {
    url: string;
    /* Lowercase hex. The archive has to match before anything is unpacked. */
    sha256: string;
    format: ArchiveFormat;
    /* The executable's path inside the archive. */
    executable: string;
}

export interface NativeRelease {
    version: string;
    sourceRevision: string;
    /* The commit of phpstorm-stubs the server was built against, which Install fetches along with it. */
    stubsCommit: string;
    /* By `<platform>-<arch>`, as Node names them (`darwin-arm64`, `linux-x64`). */
    assets: Partial<Record<string, NativeAsset>>;
}

function releaseAsset(asset: { url: string; sha256: string; format: string; executable: string }): NativeAsset {
    if (asset.format !== 'tar.gz' && asset.format !== 'zip') {
        throw new Error(`Unsupported native archive format: ${asset.format}`);
    }
    return { ...asset, format: asset.format };
}

export const NATIVE_RELEASES: Partial<Record<NativeKind, NativeRelease>> = {
    'php-native': { ...release, assets: Object.fromEntries(Object.entries(release.assets).map(([platform, asset]) => [platform, releaseAsset(asset)])) }
};

/* The native sources selected by the daemon host. */
export interface NativeCheckout {
    folder: string;
    version: string;
    stubsCommit: string;
}

const PROGRAM_NAME = 'php-language-server';

const STUBS_ARCHIVE = 'https://codeload.github.com/JetBrains/phpstorm-stubs/tar.gz/';

function programFile(platform: NodeJS.Platform): string {
    return platform === 'win32' ? `${PROGRAM_NAME}.exe` : PROGRAM_NAME;
}

/* The server's version and the stubs it pins, read from its own sources, or null when the folder is not that checkout. */
export function readNativeCheckout(folder: string): NativeCheckout | null {
    try {
        if (!existsSync(join(folder, 'Cargo.toml'))) {
            return null;
        }
        const version = /\[workspace\.package\][^[]*?\nversion\s*=\s*"([^"]+)"/.exec(readFileSync(join(folder, 'Cargo.toml'), 'utf8'))?.[1];
        const stubsCommit = /STUBS_COMMIT:\s*&str\s*=\s*"([0-9a-f]{40})"/.exec(readFileSync(join(folder, 'crates', 'index', 'src', 'stubs.rs'), 'utf8'))?.[1];
        return version === undefined || stubsCommit === undefined ? null : { folder, version, stubsCommit };
    } catch {
        return null;
    }
}

function mainCheckoutRoot(root: string): string | null {
    try {
        const gitdir = /^gitdir:\s*(.+)$/m.exec(readFileSync(join(root, '.git'), 'utf8'))?.[1]?.trim();
        if (gitdir === undefined) {
            return null;
        }
        const directory = resolve(root, gitdir);
        const common = resolve(directory, readFileSync(join(directory, 'commondir'), 'utf8').trim());
        return basename(common) === '.git' ? dirname(common) : null;
    } catch {
        return null;
    }
}

export function phpLanguageServerCheckout(
    compiled: boolean,
    sourcePath: string | null = process.env.RUIMTE_PHP_LANGUAGE_SERVER_SOURCE ?? null,
    ruimteRoot = resolve(import.meta.dir, '../../../..')
): NativeCheckout | null {
    if (compiled) {
        return null;
    }
    if (sourcePath !== null) {
        return readNativeCheckout(resolve(sourcePath));
    }
    try {
        // Anchor discovery to the sources, even when the daemon starts elsewhere or through a symlink.
        const root = realpathSync(ruimteRoot);
        const sibling = readNativeCheckout(join(dirname(root), 'language-server-php'));
        if (sibling !== null) {
            return sibling;
        }
        // A Ruimte worktree can use the standalone checkout beside its primary checkout.
        const main = mainCheckoutRoot(root);
        return main === null ? null : readNativeCheckout(join(dirname(main), 'language-server-php'));
    } catch {
        return null;
    }
}

/* What an install of a native kind does, and what it ends up running. */
export interface NativePlan {
    /* A checkout builds the server it holds; a release downloads the pinned one. */
    source: 'dev' | 'release';
    version: string;
    stubsCommit: string;
    /* The file the kind runs once installed. */
    executable: string;
    /* The build of the release for this machine; absent when the release has none, and for a checkout. */
    asset?: NativeAsset;
    /* The folder `cargo build` runs in. A checkout only. */
    checkout?: string;
}

export interface NativePolicyOptions {
    checkout: NativeCheckout | null;
    platform?: NodeJS.Platform;
    arch?: string;
    releases?: Partial<Record<NativeKind, NativeRelease>>;
}

/* A selected checkout builds its server; without one, the pinned release supplies it. */
export class NativePolicy {
    private readonly options: NativePolicyOptions;

    constructor(options: NativePolicyOptions) {
        this.options = options;
    }

    /* Null when there is nothing to install: a release build without a release of the kind. */
    plan(kind: NativeKind, installDirectory: string): NativePlan | null {
        const { checkout } = this.options;
        const platform = this.options.platform ?? process.platform;
        if (checkout !== null) {
            return {
                source: 'dev',
                version: checkout.version,
                stubsCommit: checkout.stubsCommit,
                executable: join(checkout.folder, 'target', 'release', programFile(platform)),
                checkout: checkout.folder
            };
        }
        const release = (this.options.releases ?? NATIVE_RELEASES)[kind];
        if (release === undefined) {
            return null;
        }
        const asset = release.assets[`${platform}-${this.options.arch ?? process.arch}`];
        return {
            source: 'release',
            version: release.version,
            stubsCommit: release.stubsCommit,
            executable: join(installDirectory, 'bin', asset?.executable ?? programFile(platform)),
            ...(asset ? { asset } : {})
        };
    }
}

/* `$RUIMTE_HOME/language-servers/<kind>/storage`, which the server keeps its cache in. */
export function nativeStorageOf(installDirectory: string): string {
    return join(installDirectory, 'storage');
}

/* Where the stubs of a commit sit, which is where the server itself would put them. */
export function nativeStubsOf(installDirectory: string, commit: string): string {
    return join(nativeStorageOf(installDirectory), 'stubs', commit);
}

export function stubsComplete(directory: string): Promise<boolean> {
    return access(join(directory, '.complete')).then(
        () => true,
        () => false
    );
}

/* Writes the file at the address. The default is a plain GET; tests answer from memory. */
export type Download = (url: string, destination: string) => Promise<void>;

export const download: Download = async (url, destination) => {
    const response = await fetch(url, { redirect: 'follow' });
    if (!response.ok) {
        throw new Error(`${url} answered ${response.status}`);
    }
    await writeFile(destination, new Uint8Array(await response.arrayBuffer()));
};

export async function sha256Of(path: string): Promise<string> {
    return createHash('sha256')
        .update(await readFile(path))
        .digest('hex');
}

/* Downloads the archive into a temporary folder, hands its path to `handle` and removes the folder after, whatever `handle` does. */
async function withDownload<T>(url: string, name: string, get: Download, handle: (file: string) => Promise<T>): Promise<T> {
    const folder = await mkdtemp(join(tmpdir(), 'ruimte-download-'));
    try {
        const file = join(folder, name);
        await get(url, file);
        return await handle(file);
    } finally {
        await rm(folder, { recursive: true, force: true });
    }
}

/* Downloads a release build, checks it against its pinned checksum before reading a byte of it, and unpacks it into `<directory>/bin`. */
export async function installRelease(asset: NativeAsset, directory: string, get: Download, log: (line: string) => void): Promise<void> {
    await withDownload(asset.url, `release.${asset.format}`, get, async (file) => {
        log(`Downloaded ${asset.url}`);
        const actual = await sha256Of(file);
        if (actual !== asset.sha256.toLowerCase()) {
            throw new Error(`The download does not match its checksum (expected ${asset.sha256}, got ${actual})`);
        }
        log('Checksum matches');
        const entries = readArchive(await readFile(file), asset.format);
        const target = join(directory, 'bin');
        await rm(target, { recursive: true, force: true });
        const written = await extractEntries(entries, target);
        if (!written.includes(asset.executable)) {
            throw new Error(`The release holds no ${asset.executable}`);
        }
    });
}

/*
 * The standard library stubs of a commit, into the folder the server reads them from. They come from
 * a pinned commit, which names their bytes the way a checksum would. The folder counts only once it
 * is whole, with the same marker the server itself writes, so an interrupted download starts over.
 */
export async function fetchStubs(directory: string, commit: string, get: Download, log: (line: string) => void): Promise<void> {
    const target = nativeStubsOf(directory, commit);
    if (await stubsComplete(target)) {
        return;
    }
    const partial = `${target}.partial`;
    await rm(partial, { recursive: true, force: true });
    await mkdir(partial, { recursive: true });
    await withDownload(`${STUBS_ARCHIVE}${commit}`, 'stubs.tar.gz', get, async (file) => {
        log(`Downloaded the standard library stubs of ${commit.slice(0, 7)}`);
        const entries = readArchive(await readFile(file), 'tar.gz');
        const written = await extractEntries(entries, partial, { strip: 1, keep: (path) => path.endsWith('.php') || path === 'LICENSE' });
        if (written.length === 0) {
            throw new Error('The stubs archive holds no PHP files');
        }
    });
    await writeFile(join(partial, '.commit'), commit);
    await rm(target, { recursive: true, force: true });
    await rename(partial, target);
    await writeFile(join(target, '.complete'), '');
}

/* The `cargo` a checkout builds with: the one on the PATH, else rustup's own folder, which a daemon started by the desktop app or a service may not have on its PATH. */
export function cargoCommand(): string {
    return Bun.which('cargo', { PATH: process.env.PATH ?? '' }) ?? join(homedir(), '.cargo', 'bin', 'cargo');
}
