import { LAUNCHER_NAME } from './targets';

/*
 * The order and the skips of a publish. The platform packages go first and the launcher last, so
 * no moment exists where `ruimte` on npm names a binary that is not there yet; a version already on
 * the registry is skipped, so a workflow that failed halfway can run again.
 */

export interface PackageToPublish {
    name: string;
    dir: string;
}

export interface PublishStep extends PackageToPublish {
    action: 'publish' | 'skip';
    /* npm refuses a prerelease without a dist-tag, and `latest` must never point at one. */
    tag: string | null;
}

/* Answers whether `name@version` is on the registry; throws when it cannot tell. */
export type PublishedLookup = (name: string, version: string) => Promise<boolean>;

export const distTagOf = (version: string): string | null => (version.includes('-') ? 'next' : null);

export const publishOrder = (packages: PackageToPublish[]): PackageToPublish[] => [
    ...packages.filter((entry) => entry.name !== LAUNCHER_NAME),
    ...packages.filter((entry) => entry.name === LAUNCHER_NAME)
];

export const planPublish = async (packages: PackageToPublish[], version: string, published: PublishedLookup): Promise<PublishStep[]> => {
    const steps: PublishStep[] = [];
    for (const entry of publishOrder(packages)) {
        const action = (await published(entry.name, version)) ? 'skip' : 'publish';
        steps.push({ ...entry, action, tag: distTagOf(version) });
    }
    return steps;
};

export interface CommandOutcome {
    code: number;
    stdout: string;
    stderr: string;
}

/*
 * `npm view <name>@<version> version` prints the version when it exists, prints nothing when the
 * package exists without that version, and fails with E404 when there is no package at all.
 */
export const publishedFromView = (version: string, outcome: CommandOutcome): boolean => {
    if (outcome.code === 0) {
        return outcome.stdout.trim().replace(/^"|"$/g, '') === version;
    }
    if (outcome.stderr.includes('E404')) {
        return false;
    }
    throw new Error(`npm view failed (${outcome.code}): ${outcome.stderr.trim() || outcome.stdout.trim() || 'no output'}`);
};
