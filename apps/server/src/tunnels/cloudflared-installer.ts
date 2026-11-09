import { chmod, mkdir, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { cloudflaredAsset, cloudflaredUrl } from './cloudflared-pins.ts';

class CloudflaredInstallError extends Error {}

export interface InstallerPorts {
    platform: string;
    arch: string;
    onPath(): string | null;
    exists(path: string): Promise<boolean>;
    download(url: string): Promise<Uint8Array>;
    extract(archive: string, folder: string): Promise<void>;
    sha256(bytes: Uint8Array): string;
}

/*
 * Finds `cloudflared`, or downloads Cloudflare's official build for the platform into `$RUIMTE_HOME/tunnels/bin`
 * after the sha256 pinned in the release matched. A build it cannot check is not run.
 */
export class CloudflaredInstaller {
    private readonly folder: string;
    private readonly ports: InstallerPorts;

    constructor(tunnelsFolder: string, ports: InstallerPorts) {
        this.folder = join(tunnelsFolder, 'bin');
        this.ports = ports;
    }

    private get binary(): string {
        return join(this.folder, this.ports.platform === 'win32' ? 'cloudflared.exe' : 'cloudflared');
    }

    async locate(): Promise<string | null> {
        const found = this.ports.onPath();

        if (found !== null) {
            return found;
        }

        return (await this.ports.exists(this.binary)) ? this.binary : null;
    }

    /* What to install by hand where Cloudflare ships no build for this platform; null where the installer can do it. */
    impossible(): string | null {
        return cloudflaredAsset(this.ports.platform, this.ports.arch) === null
            ? `Cloudflare publishes no cloudflared build for ${this.ports.platform} ${this.ports.arch}. Install cloudflared yourself and put it on your path.`
            : null;
    }

    async install(): Promise<string> {
        const asset = cloudflaredAsset(this.ports.platform, this.ports.arch);

        if (asset === null) {
            throw new CloudflaredInstallError(this.impossible() ?? 'No build for this platform');
        }

        let bytes: Uint8Array;

        try {
            bytes = await this.ports.download(cloudflaredUrl(asset));
        } catch {
            throw new CloudflaredInstallError('Downloading cloudflared failed. Check the connection, or install cloudflared yourself and put it on your path.');
        }

        if (this.ports.sha256(bytes) !== asset.sha256) {
            throw new CloudflaredInstallError('The cloudflared download is not the build this Ruimte release expects, so Ruimte did not install it.');
        }

        await mkdir(this.folder, { recursive: true, mode: 0o700 });

        if (asset.archive === null) {
            const staged = `${this.binary}.part`;
            await writeFile(staged, bytes, { mode: 0o755 });
            await chmod(staged, 0o755);
            await rename(staged, this.binary);

            return this.binary;
        }

        const archive = join(this.folder, asset.name);
        await writeFile(archive, bytes, { mode: 0o600 });

        try {
            await this.ports.extract(archive, this.folder);
        } finally {
            await rm(archive, { force: true });
        }

        await chmod(this.binary, 0o755);

        return this.binary;
    }
}
