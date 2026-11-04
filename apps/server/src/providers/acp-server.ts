import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { chmod, mkdir, rename, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { writeAtomic } from '@adecore/agents';
import type { AgentKind, AgentServerStatus } from '@ruimte/contracts';
import { z } from 'zod';
import { downloadFile, sha256Of, type FileDownload } from '../artifacts/artifact-fs.ts';
import { extractZipFile } from '../language/archive.ts';

const AssetSchema = z.object({
    url: z.string().url(),
    sha256: z.string().regex(/^[0-9a-f]{64}$/),
    format: z.literal('zip'),
    // The program's path inside the archive, which is what is started.
    executable: z.string().min(1),
    args: z.array(z.string())
});

const ReleaseSchema = z.object({
    version: z.string().min(1),
    // By `<platform>-<arch>`, as Node names them (`darwin-arm64`, `linux-x64`, `win32-x64`).
    assets: z.record(z.string(), AssetSchema)
});

type AcpServerAsset = z.infer<typeof AssetSchema>;
export type AcpServerRelease = z.infer<typeof ReleaseSchema>;

/* A release file as the daemon pins it; one that does not hold together is refused at load, never at Install. */
export function parseAcpServerRelease(descriptor: unknown): AcpServerRelease {
    return ReleaseSchema.parse(descriptor);
}

/* Downloads to the file and holds it to the checksum, where there is one, before anything unpacks it. */
export async function downloadChecked(download: FileDownload, url: string, destination: string, sha256: string | null): Promise<void> {
    await download(url, destination);

    if (sha256 !== null && (await sha256Of(destination)) !== sha256) {
        throw new Error('The download is damaged. Try again.');
    }
}

const InstalledSchema = z.object({ version: z.string(), sha256: z.string(), executable: z.string(), args: z.array(z.string()) });
type Installed = z.infer<typeof InstalledSchema>;

/* What a provider asks of its server: the line that starts it, once a verified copy is in place. */
export interface AcpServerLaunch {
    launch(): string[] | null;
}

interface AcpServerInstallOptions {
    provider: AgentKind;
    // `$RUIMTE_HOME`; the server lives in `agent-servers/<provider>`, which no client request reaches.
    home: string;
    release: AcpServerRelease;
    platform?: NodeJS.Platform;
    arch?: string;
    download?: FileDownload;
}

const INSTALLED_FILE = 'installed.json';

/*
 * The chat server of a CLI that ships it apart from the CLI, pinned to one version and checksum per
 * platform. Only a person's Install fetches it: the archive is checked against the pin before a byte of it
 * is unpacked, and `installed.json` is written last, so the daemon never starts a file that was not verified.
 */
export class AcpServerInstall implements AcpServerLaunch {
    private readonly provider: AgentKind;
    private readonly folder: string;
    private readonly release: AcpServerRelease;
    private readonly asset: AcpServerAsset | undefined;
    private readonly download: FileDownload;
    private installing: Promise<void> | null = null;
    private failure: string | null = null;

    constructor(options: AcpServerInstallOptions) {
        this.provider = options.provider;
        this.folder = join(options.home, 'agent-servers', options.provider);
        this.release = options.release;
        this.asset = options.release.assets[`${options.platform ?? process.platform}-${options.arch ?? process.arch}`];
        this.download = options.download ?? downloadFile;
    }

    launch(): string[] | null {
        const installed = this.installed();
        return installed === null ? null : [join(this.folder, installed.version, installed.executable), ...installed.args];
    }

    status(): AgentServerStatus {
        const installed = this.installed();
        const base = { provider: this.provider, version: this.release.version, installed: installed?.version ?? null };
        if (this.installing !== null) {
            return { ...base, state: 'installing' };
        }
        if (this.asset === undefined) {
            return { ...base, state: 'unsupported' };
        }
        if (this.failure !== null) {
            return { ...base, state: 'failed', error: this.failure };
        }
        return { ...base, state: installed === null ? 'missing' : 'installed' };
    }

    /* Puts the pinned version in place; a second press while one runs shares its outcome. */
    install(): Promise<AgentServerStatus> {
        this.installing ??= this.installNow().finally(() => {
            this.installing = null;
        });
        return this.installing.then(() => this.status());
    }

    private async installNow(): Promise<void> {
        const asset = this.asset;
        if (asset === undefined) {
            return;
        }
        this.failure = null;
        const partial = join(this.folder, `.partial-${randomBytes(6).toString('hex')}`);
        try {
            await mkdir(partial, { recursive: true, mode: 0o700 });
            const archive = join(partial, 'release.zip');
            await downloadChecked(this.download, asset.url, archive, asset.sha256);
            const unpacked = join(partial, 'server');
            const written = await extractZipFile(archive, unpacked);
            if (!written.includes(asset.executable)) {
                throw new Error(`The release holds no ${asset.executable}`);
            }
            // The archive holds only the server and the helper it starts, and a zip made elsewhere carries no mode bits.
            await Promise.all(written.map((path) => chmod(join(unpacked, path), 0o755)));
            const target = join(this.folder, this.release.version);
            await rm(target, { recursive: true, force: true });
            await rename(unpacked, target);
            const installed: Installed = { version: this.release.version, sha256: asset.sha256, executable: asset.executable, args: asset.args };
            await writeAtomic(join(this.folder, INSTALLED_FILE), `${JSON.stringify(installed, null, 2)}\n`);
        } catch (e) {
            this.failure = e instanceof Error ? e.message : String(e);
        } finally {
            await rm(partial, { recursive: true, force: true });
        }
    }

    private installed(): Installed | null {
        const path = join(this.folder, INSTALLED_FILE);
        if (!existsSync(path)) {
            return null;
        }
        try {
            const installed = InstalledSchema.parse(JSON.parse(readFileSync(path, 'utf8')));
            return existsSync(join(this.folder, installed.version, installed.executable)) ? installed : null;
        } catch {
            return null;
        }
    }
}
