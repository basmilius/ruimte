import { readFile, rename, writeFile } from 'node:fs/promises';

/* One published release, as the client draws it. Mirrored in `apps/client/src/desktop/bridge.ts`. */
export interface Release {
    /* Without the `v` of the tag. */
    version: string;
    publishedAt: string;
    /* Markdown, with the closing Full Changelog line taken off. Empty when the release has no notes. */
    body: string;
    url: string;
    compareUrl: string | null;
}

export interface ReleaseNotesState {
    releases: Release[];
    /* When GitHub last answered, whether with a list or with "nothing changed". Null before the first answer. */
    fetchedAt: string | null;
    /* Why the last fetch failed. The releases of the fetch before it stay. */
    error: string | null;
}

export const RELEASES_URL = 'https://api.github.com/repos/basmilius/ruimte/releases?per_page=20';

const SEMVER = /^v?(\d+)\.(\d+)\.(\d+)$/;

// The line GitHub's generated notes end with. It is a link, not a note, so it moves next to the date.
const FULL_CHANGELOG = /\s*\*\*Full Changelog:?\*\*:?\s*(https?:\/\/\S+)\s*$/;

const partsOf = (version: string): [number, number, number] | null => {
    const match = SEMVER.exec(version);
    return match ? [Number(match[1]), Number(match[2]), Number(match[3])] : null;
};

/* Negative when `a` is older than `b`. A version that is not semver sorts below every one that is. */
export const compareVersions = (a: string, b: string): number => {
    const left = partsOf(a);
    const right = partsOf(b);
    if (!left || !right) {
        return (left ? 1 : 0) - (right ? 1 : 0);
    }
    for (let i = 0; i < 3; i++) {
        if (left[i] !== right[i]) {
            return left[i]! - right[i]!;
        }
    }
    return 0;
};

const text = (value: unknown): string => (typeof value === 'string' ? value : '');

/*
 * The releases a person can install, newest first. A draft is not out yet and a prerelease belongs to
 * a channel the updater does not follow; once there is a beta channel this has to follow
 * `allowPrerelease`. A tag that is not semver is not a version the updater would ever offer.
 */
export const releasesFrom = (json: unknown): Release[] => {
    if (!Array.isArray(json)) {
        return [];
    }
    const releases: Release[] = [];
    for (const entry of json) {
        if (typeof entry !== 'object' || entry === null) {
            continue;
        }
        const record = entry as Record<string, unknown>;
        const tag = text(record.tag_name);
        if (record.draft === true || record.prerelease === true || !SEMVER.test(tag)) {
            continue;
        }
        // GitHub writes CRLF into a body edited in the browser.
        const raw = text(record.body).replace(/\r\n/g, '\n');
        const changelog = FULL_CHANGELOG.exec(raw);
        releases.push({
            version: tag.replace(/^v/, ''),
            publishedAt: text(record.published_at),
            body: (changelog ? raw.slice(0, changelog.index) : raw).trim(),
            url: text(record.html_url),
            compareUrl: changelog?.[1] ?? null
        });
    }
    return releases.sort((a, b) => compareVersions(b.version, a.version));
};

interface CacheFile {
    etag: string | null;
    fetchedAt: string | null;
    releases: Release[];
}

export interface ReleaseNotesOptions {
    /* `net.fetch` in the shell, which goes through Chromium's network stack and the system proxy. */
    fetch: (url: string, init: { headers: Record<string, string> }) => Promise<Response>;
    cacheFile: string;
}

export interface ReleaseNotes {
    /* The list as it stands. `refresh` asks GitHub first; without it GitHub is only asked while there is nothing to show. */
    list(refresh: boolean): Promise<ReleaseNotesState>;
}

const readCache = async (path: string): Promise<CacheFile> => {
    try {
        const parsed = JSON.parse(await readFile(path, 'utf8')) as Partial<CacheFile>;
        return {
            etag: typeof parsed.etag === 'string' ? parsed.etag : null,
            fetchedAt: typeof parsed.fetchedAt === 'string' ? parsed.fetchedAt : null,
            releases: Array.isArray(parsed.releases) ? parsed.releases : []
        };
    } catch {
        return { etag: null, fetchedAt: null, releases: [] };
    }
};

const failureOf = (status: number): string => {
    if (status === 403 || status === 429) {
        return 'GitHub is limiting requests from this network. Try again later.';
    }
    return `GitHub answered ${status}.`;
};

/*
 * The notes of the last 20 releases, kept on disk so they read offline. The ETag keeps an unchanged
 * list to a 304, which matters because an anonymous client gets 60 requests an hour per address.
 */
export const createReleaseNotes = (options: ReleaseNotesOptions): ReleaseNotes => {
    let cache: CacheFile | null = null;
    let error: string | null = null;
    let inFlight: Promise<void> | null = null;

    const stateOf = (current: CacheFile): ReleaseNotesState => ({ releases: current.releases, fetchedAt: current.fetchedAt, error });

    const save = async (next: CacheFile): Promise<void> => {
        const temp = `${options.cacheFile}.tmp`;
        try {
            await writeFile(temp, JSON.stringify(next));
            await rename(temp, options.cacheFile);
        } catch (e) {
            // The list in memory still serves this session; only the offline copy is missing.
            console.error('Could not write the release notes cache', e);
        }
    };

    const fetchList = async (current: CacheFile): Promise<void> => {
        const headers: Record<string, string> = { Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' };
        if (current.etag && current.releases.length > 0) {
            headers['If-None-Match'] = current.etag;
        }
        try {
            const response = await options.fetch(RELEASES_URL, { headers });
            if (response.status === 304) {
                cache = { ...current, fetchedAt: new Date().toISOString() };
            } else if (response.ok) {
                cache = { etag: response.headers.get('etag'), fetchedAt: new Date().toISOString(), releases: releasesFrom(await response.json()) };
            } else {
                error = failureOf(response.status);
                return;
            }
            error = null;
            await save(cache);
        } catch (e) {
            error = e instanceof Error ? e.message : 'The request did not finish.';
        }
    };

    return {
        async list(refresh) {
            cache ??= await readCache(options.cacheFile);
            if (refresh || cache.fetchedAt === null) {
                // The dialog and the update check can ask at the same moment; one request answers both.
                inFlight ??= fetchList(cache).finally(() => {
                    inFlight = null;
                });
                await inFlight;
            }
            return stateOf(cache);
        }
    };
};
