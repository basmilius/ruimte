import { launchCwdOf, sourcedLaunchId, type LaunchSourceRef } from '@ruimte/contracts';
import { errorText } from '../error-text.ts';
import { quote } from '../providers/launch.ts';

/* A project as a launch source is asked about it. */
interface SourceProject {
    id: string;
    name: string;
    folder: string;
}

interface DescribedLaunch {
    id: string;
    name: string;
    kind: 'service' | 'task';
    spawn: { command: string; args?: string[] | undefined; env?: Record<string, string> | undefined; cwd?: string | undefined };
    fingerprint: string;
    port?: number | undefined;
}

interface SourceListing {
    extension: string;
    source: string;
    title: string;
    watches: boolean;
    launches: DescribedLaunch[];
}

/* What the launch sources ask of the extensions: what each lists in a project, and to hear when that changes. */
export interface LaunchSourceHost {
    list(project: SourceProject): Promise<SourceListing[]>;
    watch(extension: string, source: string, project: SourceProject, watch: boolean): Promise<void>;
}

/* A launch a source lists, as the store resolves it: what would run, where, and what the source read to say so. */
export interface ListedLaunch {
    id: string;
    name: string;
    kind: 'service' | 'task';
    command: string;
    // Absolute. The start holds it to the project, as it does for a launch of a file.
    cwd: string;
    env: Record<string, string>;
    url: string | null;
    port: number | null;
    source: LaunchSourceRef;
    fingerprint: string;
}

interface Followed {
    project: SourceProject | null;
    launches: ListedLaunch[];
    // The sources asked to tell when their list changes, as `<extension>\n<source>`.
    watching: Set<string>;
    reading: Promise<void>;
    // A read that waits its turn, which a second ask for one joins.
    queued: Promise<void> | null;
}

interface LaunchSourcesOptions {
    host: LaunchSourceHost;
    projectOf(projectId: string): Promise<SourceProject | null>;
    /* What a project's sources list is no longer what it was. */
    changed(projectId: string): void;
}

function watchKey(extension: string, source: string): string {
    return `${extension}\n${source}`;
}

// A part a shell reads as one word as it stands, which a person then reads in the approval as the source wrote it.
const PLAIN_WORD = /^[A-Za-z0-9_@%+=:,./-]+$/;

function shellWord(part: string): string {
    return PLAIN_WORD.test(part) ? part : quote(part);
}

function listedOf(project: SourceProject, listing: SourceListing, described: DescribedLaunch): ListedLaunch {
    const { spawn } = described;
    const port = described.kind === 'service' ? (described.port ?? null) : null;

    return {
        id: sourcedLaunchId(listing.extension, listing.source, described.id),
        name: described.name,
        kind: described.kind,
        // As a terminal profile's program runs: the argument of the person's shell, each part one word.
        command: [spawn.command, ...(spawn.args ?? [])].map(shellWord).join(' '),
        cwd: launchCwdOf(project.folder, { cwd: spawn.cwd }),
        env: { ...spawn.env },
        url: port === null ? null : `http://localhost:${port}`,
        port,
        source: { extension: listing.extension, id: listing.source, title: listing.title },
        fingerprint: described.fingerprint
    };
}

/*
 * The launches the sources of extensions list, per project, for as long as a project's launches are loaded. A source only
 * describes: what it lists is kept here and started by the runner like any launch, after a person approved it. Nothing is
 * written to a project file, so a launch is gone once its source stops listing it.
 */
export class LaunchSources {
    private readonly followed = new Map<string, Followed>();
    private readonly options: LaunchSourcesOptions;

    constructor(options: LaunchSourcesOptions) {
        this.options = options;
    }

    /* Starts reading what the sources list in a project, once; `listed` has it after `settled`. */
    follow(projectId: string): void {
        if (this.followed.has(projectId)) {
            return;
        }

        const followed: Followed = { project: null, launches: [], watching: new Set(), reading: Promise.resolve(), queued: null };

        this.followed.set(projectId, followed);
        void this.refresh(projectId);
    }

    /* Settles once every read asked for so far is in. A project nobody follows has nothing to wait for. */
    settled(projectId: string): Promise<void> {
        return this.followed.get(projectId)?.reading ?? Promise.resolve();
    }

    listed(projectId: string): readonly ListedLaunch[] {
        return this.followed.get(projectId)?.launches ?? [];
    }

    /* Asks the sources again. Never rejects: a source that fails lists nothing, and its extension's log says why. */
    refresh(projectId: string): Promise<void> {
        const followed = this.followed.get(projectId);

        if (followed === undefined) {
            return Promise.resolve();
        }

        if (followed.queued !== null) {
            return followed.queued;
        }

        const next = followed.reading.then(() => {
            followed.queued = null;

            return this.read(projectId, followed);
        });

        followed.queued = next;
        followed.reading = next;

        return next;
    }

    /* An extension was turned on or off, changed or removed, or its process ended: its watches went with the process. */
    extensionChanged(extension: string): void {
        for (const [projectId, followed] of this.followed) {
            for (const key of [...followed.watching]) {
                if (key.startsWith(`${extension}\n`)) {
                    followed.watching.delete(key);
                }
            }

            void this.refresh(projectId);
        }
    }

    /* The project's launches were let go of, so its sources need not tell of changes any more. */
    release(projectId: string): void {
        const followed = this.followed.get(projectId);

        this.followed.delete(projectId);

        if (followed === undefined || followed.project === null) {
            return;
        }

        for (const key of followed.watching) {
            const [extension, source] = key.split('\n') as [string, string];

            void this.options.host.watch(extension, source, followed.project, false).catch(() => undefined);
        }
    }

    private async read(projectId: string, followed: Followed): Promise<void> {
        let listings: SourceListing[] = [];

        try {
            followed.project = await this.options.projectOf(projectId);
            listings = followed.project === null ? [] : await this.options.host.list(followed.project);
        } catch (e) {
            console.warn(`Reading the launch sources of ${projectId} failed: ${errorText(e)}`);
        }

        const { project } = followed;

        if (this.followed.get(projectId) !== followed || project === null) {
            return;
        }

        const launches = listings.flatMap((listing) => listing.launches.map((described) => listedOf(project, listing, described)));
        const changed = JSON.stringify(launches) !== JSON.stringify(followed.launches);

        followed.launches = launches;

        for (const listing of listings) {
            const key = watchKey(listing.extension, listing.source);

            if (listing.watches && !followed.watching.has(key)) {
                followed.watching.add(key);
                void this.options.host.watch(listing.extension, listing.source, project, true).catch(() => followed.watching.delete(key));
            }
        }

        if (changed) {
            this.options.changed(projectId);
        }
    }
}
