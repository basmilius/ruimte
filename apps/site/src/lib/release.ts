export const REPOSITORY = 'basmilius/ruimte';
export const REPOSITORY_URL = `https://github.com/${REPOSITORY}`;
export const RELEASES_URL = `${REPOSITORY_URL}/releases/latest`;

const LATEST_API = `https://api.github.com/repos/${REPOSITORY}/releases/latest`;

/**
 * What a person can download, keyed by the path segment of `/download/<platform>`. The suffix is
 * how electron-builder names the asset after the version.
 */
export const PLATFORMS = {
    mac: { os: 'macOS', format: 'Disk image', arch: 'Apple silicon', suffix: '-arm64.dmg' },
    'appimage-x64': { os: 'Linux', format: 'AppImage', arch: 'x64', suffix: '-x86_64.AppImage' },
    'appimage-arm64': { os: 'Linux', format: 'AppImage', arch: 'arm64', suffix: '-arm64.AppImage' },
    'deb-x64': { os: 'Linux', format: 'Debian package', arch: 'x64', suffix: '-amd64.deb' },
    'deb-arm64': { os: 'Linux', format: 'Debian package', arch: 'arm64', suffix: '-arm64.deb' },
    'rpm-x64': { os: 'Linux', format: 'RPM package', arch: 'x64', suffix: '-x86_64.rpm' },
    'rpm-arm64': { os: 'Linux', format: 'RPM package', arch: 'arm64', suffix: '-aarch64.rpm' }
} as const;

export type Platform = keyof typeof PLATFORMS;

export interface ReleaseAsset {
    readonly name: string;
    readonly url: string;
}

export interface Release {
    readonly version: string;
    readonly publishedAt: string;
    readonly assets: readonly ReleaseAsset[];
}

export function isPlatform(value: string): value is Platform {
    return Object.hasOwn(PLATFORMS, value);
}

/**
 * Reads the part of GitHub's release answer this site uses; null for anything that is not one.
 */
export function parseRelease(json: unknown): Release | null {
    if (typeof json !== 'object' || json === null) {
        return null;
    }
    const { tag_name, published_at, assets } = json as Record<string, unknown>;
    if (typeof tag_name !== 'string' || !Array.isArray(assets)) {
        return null;
    }
    return {
        version: tag_name.replace(/^v/, ''),
        publishedAt: typeof published_at === 'string' ? published_at : '',
        assets: assets.flatMap((asset: unknown) => {
            const { name, browser_download_url } = (asset ?? {}) as Record<string, unknown>;
            return typeof name === 'string' && typeof browser_download_url === 'string' ? [{ name, url: browser_download_url }] : [];
        })
    };
}

/**
 * The download link of a platform in a release, or null when that build is missing from it.
 */
export function assetUrl(release: Release, platform: Platform): string | null {
    const { suffix } = PLATFORMS[platform];
    return release.assets.find((asset) => asset.name.startsWith('Ruimte-') && asset.name.endsWith(suffix))?.url ?? null;
}

export function availablePlatforms(release: Release): Platform[] {
    return (Object.keys(PLATFORMS) as Platform[]).filter((platform) => assetUrl(release, platform) !== null);
}

/**
 * The latest published release, or null when GitHub does not answer with one. Cloudflare keeps the
 * answer for five minutes: GitHub allows 60 anonymous requests an hour per address, and a Worker
 * shares its address with others.
 */
export async function fetchLatestRelease(): Promise<Release | null> {
    const init: RequestInit & { cf?: { cacheTtl: number; cacheEverything: boolean } } = {
        headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'ruimte.app' },
        cf: { cacheTtl: 300, cacheEverything: true }
    };
    try {
        const response = await fetch(LATEST_API, init);
        return response.ok ? parseRelease(await response.json()) : null;
    } catch {
        return null;
    }
}
