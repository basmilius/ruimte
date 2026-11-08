/*
 * The `cloudflared` build the daemon downloads when it finds none on the path. Each build is checked against
 * the sha256 pinned here before it runs. A bump downloads each asset and computes the sha256 itself
 * (`bun scripts/cloudflared-pins.ts <version>`), so a changed asset on the release page never goes unnoticed.
 */
export const CLOUDFLARED_VERSION = '2026.10.7';

export interface CloudflaredAsset {
    /* The file name on the release page. */
    readonly name: string;
    readonly sha256: string;
    /* A macOS build ships in a tarball that holds the binary. */
    readonly archive: 'tgz' | null;
}

const ASSETS: Readonly<Record<string, CloudflaredAsset>> = {
    'darwin-arm64': {
        name: 'cloudflared-darwin-arm64.tgz',
        sha256: '3586ccf397e98e5f437e60e7c307ca6ac463e110580503af8bb8e6f9ebf831bd',
        archive: 'tgz'
    },
    'darwin-x64': {
        name: 'cloudflared-darwin-amd64.tgz',
        sha256: '02f3edfd87684dd5b705607688e4eb4b323f6e777b81e7b3a85af556aa356848',
        archive: 'tgz'
    },
    'linux-x64': {
        name: 'cloudflared-linux-amd64',
        sha256: '1f99fb518b83dec2ba8d870a7cc991d82a77e6196295a3d2754ba17ab9f91872',
        archive: null
    },
    'linux-arm64': {
        name: 'cloudflared-linux-arm64',
        sha256: '3df43aedc9ff291d1735b5cb576cb97e0b157488796db2e32b28aecabb445775',
        archive: null
    },
    'win32-x64': {
        name: 'cloudflared-windows-amd64.exe',
        sha256: '2493dbc168923bb3e59e5e7716f71deced92992eea9acd6e9d74f84ac7751343',
        archive: null
    }
};

/* The build for a platform, or null where Cloudflare ships none. */
export function cloudflaredAsset(platform: string, arch: string): CloudflaredAsset | null {
    return ASSETS[`${platform}-${arch}`] ?? null;
}

export function cloudflaredUrl(asset: CloudflaredAsset): string {
    return `https://github.com/cloudflare/cloudflared/releases/download/${CLOUDFLARED_VERSION}/${asset.name}`;
}
