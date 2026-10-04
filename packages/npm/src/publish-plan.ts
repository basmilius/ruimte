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
    /* Always named: npm moves `latest` to whatever is published without one. */
    tag: string;
}

export interface RegistryLookup {
    /* Whether `name@version` is on the registry; throws when it cannot tell. */
    published(name: string, version: string): Promise<boolean>;
    /* The version `latest` points at, null for a package that is not on the registry yet; throws when it cannot tell. */
    latest(name: string): Promise<string | null>;
}

/*
 * `latest` never points at a prerelease, and never moves back: a run of 0.11.0 that finishes after
 * the one of 0.11.1, or runs again, publishes under a tag of its own.
 */
export function distTagOf(version: string, latest: string | null): string {
    if (version.includes('-')) {
        return 'next';
    }
    return latest === null || Bun.semver.order(version, latest) >= 0 ? 'latest' : 'previous';
}

export function publishOrder(packages: PackageToPublish[]): PackageToPublish[] {
    return [...packages.filter((entry) => entry.name !== LAUNCHER_NAME), ...packages.filter((entry) => entry.name === LAUNCHER_NAME)];
}

export async function planPublish(packages: PackageToPublish[], version: string, registry: RegistryLookup): Promise<PublishStep[]> {
    const steps: PublishStep[] = [];
    for (const entry of publishOrder(packages)) {
        if (await registry.published(entry.name, version)) {
            steps.push({ ...entry, action: 'skip', tag: distTagOf(version, null) });
            continue;
        }
        steps.push({ ...entry, action: 'publish', tag: distTagOf(version, await registry.latest(entry.name)) });
    }
    return steps;
}

export interface CommandOutcome {
    code: number;
    stdout: string;
    stderr: string;
}

/* `npm view <name> dist-tags.latest`, which fails with E404 for a package that is not on the registry yet. */
export function latestFromView(outcome: CommandOutcome): string | null {
    if (outcome.code === 0) {
        return outcome.stdout.trim().replace(/^"|"$/g, '') || null;
    }
    if (outcome.stderr.includes('E404')) {
        return null;
    }
    throw new Error(`npm view failed (${outcome.code}): ${outcome.stderr.trim() || outcome.stdout.trim() || 'no output'}`);
}

/*
 * `npm view <name>@<version> version` prints the version when it exists, prints nothing when the
 * package exists without that version, and fails with E404 when there is no package at all.
 */
export function publishedFromView(version: string, outcome: CommandOutcome): boolean {
    if (outcome.code === 0) {
        return outcome.stdout.trim().replace(/^"|"$/g, '') === version;
    }
    if (outcome.stderr.includes('E404')) {
        return false;
    }
    throw new Error(`npm view failed (${outcome.code}): ${outcome.stderr.trim() || outcome.stdout.trim() || 'no output'}`);
}
